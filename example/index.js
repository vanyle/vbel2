const VBel = require("../index.js"); // import VBel

let vbel = new VBel({sql:null}); // create your vbel object

vbel.file("/","example/file.html"); // define some static routes
vbel.file("/static","example/static/");

// define a dynamic endpoint
let counter = 0;
vbel.endpoint("counter",{},(obj,req,res) => {
	vbel.sendSuccess(res,counter);
	counter ++;
});


// start listening !
vbel.listen(8084, () => {
	console.log("Listening to 8084")
});