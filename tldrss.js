/*****************************************/
/* CONSTANTS														 */
/*****************************************/

var DEFAULT_PORT = 3002;
var ID_LENGTH = 6;
var RESOURCES_ROOT = './resources/';
var FEED_ROOT = '/feed/'

if(process.env.PORT)
	var DOMAIN = 'https://tldrss.herokuapp.com';
else
	var DOMAIN = 'http://localhost:' + DEFAULT_PORT;

/*****************************************/
/* INITIALIZATION												 */
/*****************************************/

var fs = require('fs'),
		url = require('url'),
		mime = require('mime'),
		http = require('http'),
		express = require('express'),
		bodyParser = require('body-parser'),
		xml2js = require('xml2js'),
		request = require('request'),
		redis = require('redis'),
		tldrss = require('./package.json');

var xmlParser = new xml2js.Parser();
var xmlBuilder = new xml2js.Builder({cdata: "true"});

// Set up Express to use Jade to render views
var app = express();
app.set('views', './views');
app.set('view engine', 'jade');
app.use(bodyParser.urlencoded({extended: true}));

var server = http.createServer(app)
.listen(process.env.PORT || process.argv[2] || DEFAULT_PORT, function() {
	console.log('TLDRSS v' + tldrss.version + ' running on port: %s', server.address().port);
}).on('error', function(err) {
	if(err.code === 'EADDRINUSE') {
		console.log('Port ' + (process.env.PORT || process.argv[2] || ALT_PORT) + ' is in use. Exiting...');
	}
});

// Create Redis client and connect to Heroku Redis datastore
var redisURL = url.parse(process.env.REDIS_URL);
var redisClient = redis.createClient(redisURL.port, redisURL.hostname);
redisClient.auth(redisURL.auth.split(":")[1]);

/*****************************************/
/* ROUTING															 */
/*****************************************/

app.get('/', function(req, res) {
	res.render('home');
});

// /*	Special 'hidden' routing method to check
//  *	on the list of created feeds
//  */
// app.get('/master', function(req, res) {
// 	res.writeHead(200, {"Content-type": "text/json"});
// 	res.write(JSON.stringify(feeds, null, ' '));
// 	res.end();
// })

/* 	Path for things like favicon and site.css
 */
app.get('/resources/:resource', function(req, res) {
	var path = RESOURCES_ROOT + req.params.resource;
	readFile(path, function(err, data) {
		if(err) {
			console.log(err.message);
			send404(res, err.message);
		}
		else {
			serveData(res, data, mime.lookup(path));
		}
	})
})

/* 	Path to access previously created feeds
 */
app.get('/feed/:feedID', function(req, res) {
	redisClient.hgetall(feedID, function(err, reply) {
		if(err) {
			console.log(err.message)
			send404(res);
		}
		if(reply) {
			request(reply.host, function(err, hostRes, body) {
				if(!err && hostRes.statusCode === 200) {
					applyRules(res, feed, body, function(feedXML) {
						serveData(res, feedXML, "text/xml");
					});
				}
				else {
					send404(res);
				}
			});
		}
	});
});

app.post('/create-feed', function(req, res) {
	var host = req.body.host;
	var rule = req.body.rule;
	var feedID = getFeedID(host);
	redisClient.hgetall(feedID, function(err, reply) {
		if(err) {
			console.log(err.message);
		}
		if(reply) {
			// The key was found and the feed already exists
			var feedURL = DOMAIN + FEED_ROOT + feedID;
			renderCreateFeedPage(res, feedURL, true, true);
		}
		else {
			// The key was not found and we'll create the feed
			checkRSSFeed(host, function(isValid) {
				if(isValid) {
					redisClient.hmset(feedID, {
						'host': host,
						'rule': rule
					});
					var feedURL = DOMAIN + FEED_ROOT + feedID;
					renderCreateFeedPage(res, feedURL, false, true);
				}
				else {
					renderCreateFeedPage(res, false, false, false);
				}
			});
		}
	});
});

/*	Send a 404 response for any unrecognized paths
 */
app.get('/*', function(req, res) {
	send404(res);
})

/*****************************************/
/* HELPER FUNCTIONS											 */
/*****************************************/

function renderCreateFeedPage(res, feedURL, feedExists, hostFeedIsValid) {
	res.render('create-feed', {url: feedURL, feedExists: feedExists, hostFeedIsValid: hostFeedIsValid});
}

/*	Checks to see whether an RSS feed responds
 *	with an XML file.
 *	hostURL (String) - URL of the host feed
 */
function checkRSSFeed(hostURL, callback) {
	request(hostURL, function(err, hostRes, body) {
		if(!err && hostRes.statusCode === 200) {
			if(hostRes.headers['content-type'].search('xml') >= 0) {
				callback(true);
			}
		}
		callback(false);
	});
}

/* Takes a host URL as input and hashes
 * it to create a feedID. Note that the 
 * the feedID is not guaranteed to be
 * unique.
 *	
 * hostURL (String)
 */
function getFeedID(hostURL) {
	var feedIDAllowedChars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMOPQRSTUVWXYZ';
	var charLength = hostURL.length / ID_LENGTH;
	var feedID = '';
	for(var i = 0; i < ID_LENGTH; i++) {
		var charCodeSum = 0;
		for(var j = i; j < hostURL.length; j+= charLength) {
			charCodeSum += hostURL.charCodeAt(j);
		}
		feedID.concat(charCodeSum % feedIDAllowedChars.length);
	}
	return feedID;
}

/*	Sends a 404 HTTP response.
 */
function send404(res, message) {
	res.writeHead(404, {"Content-type" : "text/plain"});
	if(message) {
		res.write("Error 404: " + message);
	}
	else {
		res.write("Error 404: Resource not found.");
	}
	res.end();
}

/*	Generic function to serve some data to a client.
 *
 *	data, mimeType (String)
 */
function serveData(res, data, mimeType) {
	res.writeHead(200, {"Content-type" : mimeType});
	res.end(data);
}

/*	Applies the rules for a particular feed to 
 *	that feed's XML content and serves the
 *	altered XML file to the connected client
 *	
 *	feed (Object)
 *	body (String) - unaltered XML content of the
 *									host feed
 *	callback (fn(String)) - parameter is the 
 *		altered XML text
 */
function applyRules(res, feed, body, callback) {
	xmlParser.parseString(body, function(err, result) {
		var numEpisodes = result.rss.channel[0].item.length;
		for(var index = 0; index < numEpisodes; index++) {
			if(index % Number(feed.rule) != 0) {
				delete result.rss.channel[0].item[index];
			}
		}
		callback(xmlBuilder.buildObject(result));
	});
}

/*****************************************/
/* FILE I/O															 */
/*****************************************/

/*	Reads the file at the specified path, if it exists, and returns
 *	the contents of the file. This function is used after
 *	initialization is complete when we want things to happen
 *	asynchronously.
 *
 *	path (String)
 *	callback (function(err, data))
 */
function readFile(path, callback) {
	fs.exists(path, function(exists) {
		if(exists) {
			fs.readFile(path, function(err, data) {
				if(err) {
					callback(err, data);
				}
				else {
					callback(null, data);
				}
			});
		}
		else {
			callback(new Error("The file at path " + path + " does not exist."));
		}
	});
}
