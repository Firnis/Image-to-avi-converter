var app = require('derby').createApp(module)
	.use(require('derby-ui-boot'))
	.use(require('../../ui'))


// ROUTES //

// Derby routes are rendered on the client and the server
app.get('/', function(page, model) {
	var userId = model.get('_session.userId');

	var user = model.at('users.' + userId);

	var imagesQuery = model.query('images', {userId: userId});

	model.subscribe(user, imagesQuery, function(err) {
		if (err) return next(err);

		model.ref("_page.user", user);
		imagesQuery.ref("_page.images");

		page.render('home');
	});

});

app.get('/video', function(page, model, params, next) {
	var userId = model.get('_session.userId');

	var user = model.at('users.' + userId);

	var videosQuery = model.query('videos', {userId: userId});

	model.subscribe(user, videosQuery, function(err) {
		if (err) return next(err);

		model.ref('_page.user', user);
		videosQuery.ref('_page.videos');

		page.render('video');
	});
});

// CONTROLLER FUNCTIONS //

app.fn('video.remove', function(e) {
	var video = e.get(':video');
	this.model.del('videos.' + video.id);
});

app.fn('image.remove', function(e) {
	var image = e.get(':image');
	this.model.del('images.' + image.id);
});

app.view.fn('block_width', function(image, images, user) {
	// pageWidth = 1000
	// 30 = seconds in line

	var duration = 0;

	if( !user.manual_duration )	{
		duration = user.duration / images.length;
	}
	else {
		duration = image.duration;
	}
	return (1000 / 30) * duration;
});

app.view.fn('fullduration', function(images, duration) {
	var length = 0;

	for (var i = images.length - 1; i >= 0; i--) {
		length += parseInt(images[i].duration);
	};

	duration = parseInt(length);

	return length;
});

exports.uploadImage = function(e, el, next) {

	// send image
	var oMyForm = new FormData();
	oMyForm.append("image", el.files[0]);

	var oReq = new XMLHttpRequest();
	oReq.open("POST", "/image/upload");

	oReq.send(oMyForm);
	el.value = '';
}

exports.lock = function(e, el, next) {
	var user = e.get('_page.user');

	if( user.manual_duration ) {
		el.parentElement.lock = true;
	}
}

exports.unlock = function(e, el, next) {
	
	if( el.lock && el.duration ) {
		var image = el.imageModel || e.get(":image");

		var duration = el.duration;

		el.imageModel = image;

		// сохраняем новое значение в базу
		if( image.duration != duration ) {

			image.duration = duration;
			this.model.set("images." + image.id, image);
		}
	}

	el.lock = false;
}

exports.resize = function(e, el, next) {
	if( el.lock ) {
		var div  		= el,
			cache		= div.cache || {};

			grip 		= cache.grip || div.getElementsByClassName('carret')[0],
			duration 	= cache.duration || div.getElementsByClassName('duration')[0],

			halfGrip 	= cache.halfGrip || grip.clientWidth / 2,

			offsetLeft  = cache.offsetLeft || (div.offsetParent.offsetLeft + div.offsetLeft) - halfGrip,

			newWidth 	= e.clientX - offsetLeft;

		div.cache = {
			offsetLeft: offsetLeft,
			duration: 	duration,
			grip: 		grip,
			halfGrip: 	halfGrip
		};

		div.style.width 	= newWidth + "px";

		div.duration 		= (newWidth / (1000 / 30)).toFixed();

		duration.innerHTML 	= "00:00:" + div.duration;
	}
}
