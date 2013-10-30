var express = require('express');
var derby = require('derby');
var racerBrowserChannel = require('racer-browserchannel');
var liveDbMongo = require('livedb-mongo');
var MongoStore = require('connect-mongo')(express);
var app = require('../app');
var error = require('./error');
var fs = require('fs');
var ffmpeg = require('fluent-ffmpeg');
var path = require('path');
var exec = require('child_process').exec;

var expressApp = module.exports = express();

// Get Redis configuration
if (process.env.REDIS_HOST) {
	var redis = require('redis').createClient(process.env.REDIS_PORT, process.env.REDIS_HOST);
	redis.auth(process.env.REDIS_PASSWORD);
} else if (process.env.REDISCLOUD_URL) {
	var redisUrl = require('url').parse(process.env.REDISCLOUD_URL);
	var redis = require('redis').createClient(redisUrl.port, redisUrl.hostname);
	redis.auth(redisUrl.auth.split(":")[1]);
} else {
	var redis = require('redis').createClient();
}
redis.select(process.env.REDIS_DB || 1);
// Get Mongo configuration 
var mongoUrl = process.env.MONGO_URL || process.env.MONGOHQ_URL ||
	'mongodb://localhost:27017/project';

// The store creates models and syncs data
var store = derby.createStore({
	db: liveDbMongo(mongoUrl + '?auto_reconnect', {safe: true})
, redis: redis
});

function createUserId(req, res, next) {
	var model = req.getModel();
	var userId = req.session.userId || (req.session.userId = model.id());
	model.set('_session.userId', userId);
	next();
}

expressApp
	.use(express.favicon())
	// Gzip dynamically
	.use(express.compress())
	// Respond to requests for application script bundles
	.use(app.scripts(store))
	// Serve static files from the public directory
	// .use(express.static(__dirname + '/../../public'))

	// Add browserchannel client-side scripts to model bundles created by store,
	// and return middleware for responding to remote client messages
	.use(racerBrowserChannel(store))
	// Add req.getModel() method
	.use(store.modelMiddleware())

	// Parse form data
	.use(express.bodyParser())
	.use(express.methodOverride())

	// Session middleware
	.use(express.cookieParser())
	.use(express.session({
		secret: process.env.SESSION_SECRET || 'YOUR SECRET HERE'
	, store: new MongoStore({url: mongoUrl, safe: true})
	}))
	.use(createUserId)

	// Create an express middleware from the app's routes
	.use(app.router())
	.use(expressApp.router)
	.use(error())

	.use(fs)
	.use(ffmpeg)
	.use(path)
	.use(exec)


// SERVER-SIDE ROUTES //

var Converter = function(config) {
	this.init(config);
};

Converter.prototype = {
	model: null,	// required
	user: null,		// required
	images: [],		// required
	user_id: 0,		// required

	counter: 0,
	duration: [],
	videos: [],
	tmpPath: '',
	video: null,

	init: function(config) {
		for(c in config) {
			this[c] = config[c];
		}

		this.counter = this.images.length;
		this.tmpPath = '/tmp/' + this.user_id + '/';
	},

	start: function() {
		// TODO:
		// add video model to collection
		// create tmp folder /tmp/video.id

		var video_id = this.model.add('videos', {
			userId: this.user_id,
			name: 'video.avi',
			size: 0,
			data: null,
			date: new Date()
		});

		this.video = this.model.get('videos.' + video_id);

		this.tmpPath = '/tmp/' + video_id + '/';

		try {
			fs.mkdirSync(this.tmpPath);
		}
		catch(e) {}

		for (var i = this.images.length - 1; i >= 0; i--) {
			this.convertImage( i );
		};
	},

	convertImage: function(index) {
		var converter = this;
		var image = this.images[index];
		var imagePath = this.tmpPath + index + '_' + image.name.replace(/\s/g, '_');

		// hack! 
		// ffmpeg неверное обрабатывает duration последнего файла в списке
		// list.txt
		var last = index == converter.images.length - 1;

		var duration = this.user.manual_duration ? image.duration : (this.user.duration / this.images.length);

		this.duration[index] = duration;

		fs.writeFile(imagePath, image.data, 'base64', function(err) {
			var proc = new ffmpeg({
				source: imagePath,
				noLog: true
			})
			.loop( last ? duration : 1 )
			.withFps(12)
			.withSize('1080x1920')
			.withVideoCodec('libx264')
			.applyAutopadding(true, 'white')
			.saveToFile(imagePath + '.m4v', function(retcode, err) {

				converter.imageFinished( index, imagePath + '.m4v' );

			});
		});
	},

	imageFinished: function(index, file) {
		this.counter--;

		this.videos[index] = file;

		if( this.counter == 0 ) {
			this.finish();
		}
	},

	finish: function() {
		var converter = this;

		{
			var mergeStr   = '';
			var resultFile = converter.tmpPath + 'result.m4v';
			var listFile   = converter.tmpPath + 'list.txt';

			if( this.videos.length == 1 ){
				fs.readFile( this.videos[0], 'base64', function(err, data) {
					var video = converter.video;

					video.data = data;
					video.size = data.length;

					converter.model.set("videos." + video.id, video);

					fs.unlink( converter.tmpPath, function() {} );
				});
			}
			else {

				for (var i = 0, len = this.videos.length; i < len; i++) {
					mergeStr += "file '" + this.videos[i] + "'\n";

					mergeStr += "duration " + this.duration[i] + "\n";
				};

				fs.writeFile(listFile, mergeStr, function() {
					var command = [
						'ffmpeg',
						[
							'-loglevel', 'verbose', //Generetes too much muxing warnings and fills default buffer of exec. This is to ignore them.
							'-f', 'concat',
							'-i', listFile,
							'-c', 'copy',
							resultFile
						].join(' ')
					];

					exec(command.join(' '), function(err, stdout, stderr) {
						if(err) throw err;

						console.log("finished!");

						fs.readFile( resultFile, 'base64', function(err, data) {
							var video = converter.video;

							video.data = data;
							video.size = data.length;

							converter.model.set("videos." + video.id, video);

							fs.unlink( converter.tmpPath, function() {} );
						});
					});
				});
			}

		}

	}
};

expressApp.get('/make/my/awersome/video', function(req, res) {
	var model 	= req.getModel(),
		userId 	= model.get('_session.userId'),
		user 	= model.at('users.' + userId),
		images 	= model.query('images', {userId: userId});

	model.fetch(user, images, function(err) {
		var myImages = images.get();

		var converter = new Converter({
			user_id: userId,
			user: user.get(),
			model: model,
			images: myImages
		});

		converter.start();

		res.redirect('/video');
	});
});

expressApp.post('/image/upload', function(req, res) {
	var image   = req.files.image;
	var model   = req.getModel();
	var userId  = model.get('_session.userId');

	var data	= fs.readFileSync( image.path, 'base64' );

	model.add('images', {
		name: image.name,
		size: parseInt(image.size),
		type: image.type,
		data: data,
		duration: parseInt(10),
		userId: userId
	});

});

expressApp.get('/image/get/:id', function(req, res) {
	var id	  	= req.params.id;
	var model   = req.getModel();

	var images  = model.query('images', {id: id});

	images.fetch(function(err) {
		var image = images.get()[0];

		res.set( 'Content-Type', image.type );

		res.send( image.data );
	});

});

expressApp.get('/video/get/:id', function(req, res) {
	var id	  	= req.params.id;
	var model   = req.getModel();

	var videos  = model.query('videos', {id: id});

	videos.fetch(function(err) {
		var video = videos.get()[0];

		res.set({
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': 'attachment;filename="' + video.name + '"',
			'ETag': video.id
		});

		res.send( new Buffer(video.data, 'base64') );
	});

});

expressApp.all('*', function(req, res, next) {
	next('404: ' + req.url);
});
