//Create variable request activating the "request" module
var request = require("request")

//Set the URL to get the jokes from
var url = "http://tambal.azurewebsites.net/joke/random"

//Create a default variable for the joke
var joke = "not known";
/**
 Finds the joke from the url using JSON and request and lists a callback for the user to get the joke
*/
exports.getJoke = function(callback){
//Request settings (json formating true, and is url)
request({
    url: url,
    json: true
}, function (error, response, body) {
    //Check for errors
    if(error) throw new Error(error);
    //Make sure there is no error and make sure the page is loaded
    if (!error && response.statusCode === 200) 
        callback(body.joke); //Callback to joke
})
}

