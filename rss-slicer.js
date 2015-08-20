/*****************************************/
/* CONSTANTS														 */
/*****************************************/

var DEFAULT_PORT = 3002;
var FEEDS_PATH = './feeds.json';
var RESOURCES_ROOT = './resources/';
var FEED_ROOT = '/feed/'
if(process.env.PORT) {
	var DOMAIN = 'https://www.rss-slicer.herokuapp.com';
}
else {
	var DOMAIN = 'http://localhost:' + DEFAULT_PORT;
}

/*****************************************/
/* INITIALIZATION												 */
/*****************************************/

var fs = require('fs'),
		bodyParser = require('body-parser'),
		mime = require('mime'),
		http = require('http'),
		express = require('express'),
		xml2js = require('xml2js'),
		request = require('request'),
		fracas = require('./package.json');

var xmlParser = new xml2js.Parser();
var xmlBuilder = new xml2js.Builder({cdata: "true"});

var app = express();
app.set('views', './views');
app.set('view engine', 'jade');
app.use(bodyParser.urlencoded({extended: true}));

var server = http.createServer(app).listen(process.env.PORT || process.argv[2] || DEFAULT_PORT, function() {
	console.log('RSS Slicer v' + fracas.version + ' running on port: %s', server.address().port);
}).on('error', function(err) {
	if(err.code === 'EADDRINUSE') {
		console.log('Port ' + (process.env.PORT || process.argv[2] || ALT_PORT) + ' is in use. Exiting...');
	}
});

try {
	var feeds = JSON.parse(readFileSync(FEEDS_PATH));
} catch(err) {
	console.log(err.message);
	if(!feeds) {
		var feeds = {};
	}
}

/*****************************************/
/* ROUTING															 */
/*****************************************/

app.get('/', function(req, res) {
	res.render('home');
});

app.get('/info', function(req, res) {
	res.render('info');
})

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

app.get('/feed/:feed', function(req, res) {
	var feed;
	try {
		feed = getFeed(req.params.feed)
	} catch(err) {
		send404(res, err.message);
	}
	if(feed) {
		request(feed.host, function(err, hostRes, body) {
			if(!err && hostRes.statusCode === 200) {
				applyRules(feed, body, res);
			}
		});
	}
});

app.post('/create-feed', function(req, res) {
	var host = req.body.host;
	var rule = req.body.rule;
	var ID = String(feeds.length);
	feeds[feeds.length] = {
		host: host,
		rule: rule,
		ID: ID
	};
	var url = DOMAIN + FEED_ROOT + ID;
	res.render('create-feed', {url: url});
	writeFile(FEEDS_PATH, JSON.stringify(feeds, null, ' '), function(err, written, string) {
		if(err) {
			console.log(err.message);
		}
	});
});

/*****************************************/
/* HELPER FUNCTIONS											 */
/*****************************************/

/*	Finds a feed object in the feeds array
 *	with the given feed ID (URL slug)
 *	feed (String)
 */
function getFeed(feedID) {
	for(var i = 0; i < feeds.length; i++) {
		if(feedID === feeds[i].ID) {
			return feeds[i];
		}
	}
	throw new Error('No stored feeds with ID: ' + feedID);
}

/*	Sends a 404 HTTP response.
 */
function send404(res, message) {
	res.writeHead(404, {"Content-type" : "text/plain"});
	res.write(("Error 404: " + message) || "Error 404: Resource not found.");
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
 */
function applyRules(feed, body, res) {
	xmlParser.parseString(body, function(err, result) {
		var numEpisodes = result.rss.channel[0].item.length;
		for(var index = 0; index < numEpisodes; index++) {
			if(index % Number(feed.rule) != 0) {
				delete result.rss.channel[0].item[index];
			}
		}
		serveData(res, xmlBuilder.buildObject(result), "text/xml");
	});
}

/*****************************************/
/* FILE I/O															 */
/*****************************************/

/*	Reads the file at the specified path, if it exists, and returns
 *	the contents of the file. This function is used for initialization
 *	when we want things to happen synchronously.
 *
 *	path (String)
 */
function readFileSync(path) {
	if(fs.existsSync(path)) {
		try {
			var data = fs.readFileSync(path);
			return data;
		} 
		catch (err) {
			throw err;
		}
	}
	else {
		throw new Error("The file at path " + path + " does not exist.");
	}
}

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

/*	Writes a file to disk.
 *
 *	path, data (String)
 */
function writeFile(path, data, callback) {
	fs.open(path, 'w', function(err, fd) {
		fs.write(fd, data, function(err, written, string) {
			if(err) {
				callback(err, written, string);
			}
			else {
				callback(null, written, string);
			}
		});
	});
}