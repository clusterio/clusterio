export function getParameterByName(name, url) {
    if(!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if(!results) return null;
    if(!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}

// ctx, entityImages[name].img, xPos, yPos, size.x, size.y, rotation, sprWidth, sprHeight, offLeft, offTop
export function drawImageWithRotation(ctx, image, x, y, w, h, degrees, sprWidth, sprHeight, offLeft, offTop, flipX, flipY){
	ctx.save();
	ctx.translate(x+w/2, y+h/2);
	ctx.rotate(degrees*Math.PI/180.0);
	ctx.translate(-x-w/2, -y-h/2);
	if(flipX) {
		x -= x*2+sprWidth;
		ctx.scale(-1, 1);
	}
	if(flipY){
		y -= y*2+sprHeight;
		ctx.scale(1, -1);
	}
	
	if(sprWidth != undefined && sprHeight != undefined && offLeft != undefined && offTop != undefined){
		// console.log(sprWidth+" "+sprHeight+" "+offLeft+" "+offTop+" "+w+" "+h)
		ctx.drawImage(image, offLeft, offTop, sprWidth, sprHeight, x, y, w, h);
	} else {
		ctx.drawImage(image, x, y, w, h);
	}
	ctx.restore();
}