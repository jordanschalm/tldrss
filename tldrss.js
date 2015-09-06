/*****************************************/
/* CONSTANTS														 */
/*****************************************/

var DEFAULT_PORT = 3002;
var ID_LENGTH = 6;
var RESOURCES_ROOT = '/resources/';
var FEED_ROOT = '/feed/'

/*****************************************/
/* INITIALIZATION												 */
/*****************************************/

var url = require('url'),
		path = require('path'),
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

var app = express();
app.use(bodyParser.json());

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
	res.sendFile(path.join(__dirname + '/views/home.html'));
});

/* 	Path for things like favicon and site.css
 */
app.get('/resources/:resource', function(req, res) {
	var resPath = RESOURCES_ROOT + req.params.resource;
	res.sendFile(path.join(__dirname + resPath));
});

/* 	Path to access previously created feeds
 */
app.get('/feed/:feedID/:rule', function(req, res) {
	var feedID = req.params.feedID;
	var rule = req.params.rule
	redisClient.get(feedID, function(err, reply) {
		if(err) {
			console.log(err.message)
			send404(res);
		}
		if(reply) {
			request(reply, function(err, hostRes, body) {
				if(!err && hostRes.statusCode === 200) {
					applyRules(res, rule, body, function(feedXML) {
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
	console.log('host: ' + host + '\trule: ' + rule);
	if(!host || !rule) {
		// One of the inputs is undefined
		var resErr = new Error("An error occurred. Please try again.");
		serveData(res, JSON.stringify({feedID: null, host: host, rule: rule, err: resErr}), "text/json");
	}
	else if(host.length === 0) {
		// Empty host URL input
		var resErr = new Error("Please enter a valid URL and try again.");
		serveData(res, JSON.stringify({feedID: feedID, host: host, rule: rule, err: resErr}));
	}
	else {
		host = normalizeURL(host);
		var feedID = getFeedID(host);
		redisClient.get(feedID, function(err, reply) {
			if(err) {
				console.log(err.message);
			}
			if(reply) {
				// The key was found so the feed exists
				serveData(res, JSON.stringify({feedID: feedID, host: host, rule: rule, err: false}), "text/json");
			}
			else {
				checkRSSFeed(host, function(validRSSFeed, httpStatusCode, err) {
					if(err) {
						console.log(err);
						var resErr = new Error("Something went wrong while checking " + host + " for a valid RSS feed. You may have entered an invalid URL or the host server may be temporarily unavailable. Please try again.");
						serveData(res, JSON.stringify({feedID: feedID, host: host, rule: rule, err: resErr}));
					}
					else {
						if(validRSSFeed) {
							redisClient.set(feedID, host);
							serveData(res, JSON.stringify({feedID: feedID, host: host, rule: rule, err: false}), "text/json");
						}
						else if(httpStatusCode != 200) {
							var resErr = new Error("Something went wrong while checking " + host + " for a valid RSS feed. The server responded with status code " + httpStatusCode + ".");
							serveData(res, JSON.stringify({feedID: feedID, host: host, rule: rule, err: resErr}));
						}
						else {
							var resErr = new Error(host + " does not lead to a valid RSS feed. Please ensure the host URL leads to a valid RSS feed.");
							serveData(res, JSON.stringify({feedID: feedID, host: host, rule: rule, err: resErr}));
						}
					}
				});
			}
		});
	}
});

/*	Send a 404 response for any unrecognized paths
 */
app.get('/*', function(req, res) {
	send404(res);
});

/*****************************************/
/* HELPER FUNCTIONS											 */
/*****************************************/

/*	Checks to see whether an RSS feed responds
 *	with an XML file.
 *	hostURL (String) - URL of the host feed
 */
function checkRSSFeed(hostURL, callback) {
	request(hostURL, function(err, hostRes, body) {
		if(err) {
			callback(false, null, err);
		}
		else {
			if(hostRes.statusCode === 200 && hostRes.headers['content-type'].search('xml') >= 0) {
				// Valid URL AND RSS feed
				callback(true, hostRes.statusCode);
			}
			callback(false, hostRes.statusCode);
		}
	});
}

/*	If necessary appends http:// or
 *	http://www. to a host URL. No guarantee
 *	that the output URL is valid.
 */
function normalizeURL(host) {
	if(host.match(/^http:\/\//)) {
		return host;
	}
	else if(host.match(/^www/)) {
		return 'http://' + host;
	}
	else {
		return 'http://www.' + host;
	}
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
	var charLength = Math.floor(hostURL.length / ID_LENGTH);
	var feedID = '';
	for(var i = 0; i < ID_LENGTH; i++) {
		var charCodeSum = 0;
		for(var j = i; j < hostURL.length; j+= charLength) {
			charCodeSum += hostURL.charCodeAt(j);
		}
		feedID = feedID.concat(feedIDAllowedChars[charCodeSum % feedIDAllowedChars.length]);
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
	res.write(data);
	res.end();
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
function applyRules(res, rule, body, callback) {
	xmlParser.parseString(body, function(err, result) {
		var numEpisodes = result.rss.channel[0].item.length;
		for(var index = 0; index < numEpisodes; index++) {
			if(index % Number(rule) != 0) {
				delete result.rss.channel[0].item[index];
			}
		}
		callback(xmlBuilder.buildObject(result));
	});
}