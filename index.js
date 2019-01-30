const express = require("express");
const moment = require("moment");
var fs = require("fs"),
  es = require("event-stream");
var app = express();
var http = require("http");
var cors = require("cors");
const socketIo = require("socket.io");
const server = http.createServer(app);
const io = socketIo(server);
var elasticsearch = require("elasticsearch");
const uuidv1 = require("uuid/v1");
const port = process.env.PORT || 4001;
var router = express.Router();
const axios = require("axios");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");

app.use(cors());
// Init Variables
let logsCountPerSecond = 0,
  currentLine = 1,
  readLine = 0,
  logsThresholdCount = 200,
  alertEmailAddress = "logs@codingmart.com",
  alertRules = [];
const logFileLocation = "public/test.txt";
let alertEmailAddressArray,
  intervalObject = {};

// Pattern Init
var patterns = require("node-grok").loadDefaultSync();
var p =
  '%{IP:client} - - %{DATA:timestamp} "%{WORD:method} %{URIPATHPARAM:url} %{WORD:http}/%{INT:ver}.%{INT:ver2}" %{INT:response} %{INT:request} "%{DATA:mtag}" "%{DATA:agent}"';
var pattern = patterns.createPattern(p);

//To Get Initial settings config
initialSettingsConfig();

// Use Body Parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// To Get Settings Config
app.get("/settings", function(req, res, next) {
  let obj = {
    logsThresholdCount: logsThresholdCount,
    alertEmailAddress: alertEmailAddress,
    alertEmailAddressArray: alertEmailAddressArray,
    alertRules: alertRules
  };
  res.json(obj);
});

app.get("/get-alert-rules", function(req, res, next) {
  let obj = { alertRules: alertRules };
  res.json(obj);
});

// To Add Alert Rules Config
app.post("/add-alert-rules", (req, res) => {
  const alert = req.body;
  alert.alertUid = uuidv1();
  alertRules.push(req.body);
  runAlert(alert);
  updateSettingsConfig();
  res.send("Successfully Added");
});

// To Update Alert Rules Config
app.post("/update-alert-state", (req, res) => {
  let obj = req.body;
  alertRules.forEach(doc => {
    if (doc.alertUid == obj.alertUid) {
      if (obj.alertState) {
        unSubscribeTimeInterval(obj.alertUid);
        doc.alertState = false;
      } else {
        runAlert(doc);
        doc.alertState = true;
      }
    }
  });
  updateSettingsConfig();
  res.send("Successfully Updated");
});

// To Update Alert Rules Config
app.post("/delete-alert-state", (req, res) => {
  let obj = req.body;
  const newAlertRules = alertRules.filter(x => x.alertUid != obj.alertUid);
  alertRules = newAlertRules;
  unSubscribeTimeInterval(obj.alertUid);
  updateSettingsConfig();
  res.send("Successfully Updated");
});

function unSubscribeTimeInterval(uid) {
  clearInterval(intervalObject[uid]);
}

// Socket IO
io.on("connection", socket => {
  socket.on("disconnect", () => console.log("Client disconnected"));
});

// Init Elastic Search
var client = new elasticsearch.Client({
  host: "localhost:9200",
  log: "trace"
});

client.ping(
  {
    // ping usually has a 3000ms timeout
    requestTimeout: 1000
  },
  function(error) {
    if (error) {
      console.trace("elasticsearch cluster is down!");
    } else {
      // console.log("All is well");
    }
  }
);

function initialSettingsConfig() {
  var text = fs.readFileSync("public/settings.txt", "utf8");
  var settingsConfig = JSON.parse(text);
  alertRules = settingsConfig.alertRules;
  callAlertRules(alertRules);
}

function callAlertRules(alertRules) {
  alertRules.map(alert => {
    if (alert.alertState) {
      runAlert(alert);
    }
  });
}

function runAlert(alert) {
  console.log("Running New Alert - ", alert.alertName);
  // Set Interval
  let interval = setInterval(() => {
    // If State Active
    if (alert.alertState) {
      alert.alertGTE = moment()
        .subtract(alert.alertRangeValue, alert.alertRangeMetric)
        .format();
      alert.alertLTE = moment().format();
      console.log(alert.alertGTE, alert.alertLTE);
      fetchQuery(alert);
    } else {
      console.log("Job Stopped", alert.alertName);
    }
  }, alert.alertFrequency);
  intervalObject[alert.alertUid] = interval;
}

// Fetch Data with Query

function fetchQuery(alert) {
  // Query
  const apiURL = "http://localhost:9200/logsindexnew/_search";
  const query = {
    query: {
      bool: {
        must: [{ match: { [alert.alertFieldType]: alert.alertFieldName } }],
        filter: [
          {
            range: {
              timestamp: {
                gte: alert.alertGTE,
                lte: alert.alertLTE
              }
            }
          }
        ]
      }
    }
  };
  // console.log(query);

  console.log("Calling", alert.alertName);
  axios.post(apiURL, query).then(response => {
    obtainedHits = response.data.hits.total;
    compareHitsToThreshold(alert, obtainedHits);
  });
}

//compare Obtained Hits With Threshold
function compareHitsToThreshold(alert, obtainedHits) {
  console.log("ObtainedHits for ", alert.alertName, " - ", obtainedHits);
  // console.log("Operator", alert.alertOperator);
  if (alert.alertOperator == ">") {
    if (obtainedHits > alert.alertThresholdLimit) {
      // alertClient();
      alertSMS(alert.alertMobileNumberArray);
      alertMail(alert.alertEmailAddressArray);
    }
  } else if (alert.alertOperator == "<") {
    if (obtainedHits < alert.alertThresholdLimit) {
      // alertClient();
      alertMail();
      alertSMS(alert.alertMobileNumberArray);
      alertMail(alert.alertEmailAddressArray);
    }
  } else if (alert.alertOperator == "==") {
    if (obtainedHits == alert.alertThresholdLimit) {
      // alertClient();
      alertMail();
      alertSMS(alert.alertMobileNumberArray);
      alertMail(alert.alertEmailAddressArray);
    }
  }
}

function updateSettingsConfig() {
  var json = {
    logsThresholdCount: logsThresholdCount,
    alertEmailAddress: alertEmailAddress,
    alertEmailAddressArray: alertEmailAddressArray,
    alertRules: alertRules
  };

  fs.writeFile("public/settings.txt", JSON.stringify(json), err => {
    if (err) throw err;
    console.log("settings updated");
  });
}

// Init Stream Data
streamData();
watchFile();
// findNoOfLogsPerSecond();

// Find No of Logs Per Second!
// function findNoOfLogsPerSecond() {
//   setInterval(() => {
//     console.log("Logs Count Per Second", logsCountPerSecond);

//     if (logsCountPerSecond > logsThresholdCount) {
//       alertClient();
//       alertMail();
//     } else {
//       console.log("Status Normal");
//     }
//     logsCountPerSecond = 0;
//     console.log("Logs Counter Zero Log C", logsCountPerSecond);
//   }, 1000);
// }

// function alertClient() {
//   let jsonObj = {
//     message: "Over Threshold Limit"
//   };
//   io.emit("alertThresholdLimit", jsonObj);
// }

// Send SMS (Alert)

function alertSMS(mobileNumberArray) {
  var http = require("http");
  var urlencode = require("urlencode");
  console.log("Sending SMS", mobileNumberArray);
  if (mobileNumberArray)
    mobileNumberArray.map(doc => {
      console.log("Sending Message");
      var msg = urlencode("HEYYY! ERROOOR! HELP ME XD");
      var toNumber = doc.mobile; //number
      var username = "saghana@codingmart.com"; //user-email id
      var hash =
        "dd2ab429a40630a24df31c52f61ddc181662ba022493465fcb06546e7dc28130"; //hash key
      var sender = "txtlcl";
      var data =
        "username=" +
        username +
        "&hash=" +
        hash +
        "&sender=" +
        sender +
        "&numbers=" +
        toNumber +
        "&message=" +
        msg;
      var options = {
        host: "api.textlocal.in",
        path: "/send?" + data
      };

      callback = function(response) {
        var str = "";
        response.on("data", function(chunk) {
          str += chunk;
        });
        response.on("end", function() {
          console.log(str);
        });
      };
      http.request(options, callback).end();
    });
}

// Send Email (Alert)
function alertMail(alertEmailAddressArray) {
  console.log("Email is Sending");
  var transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "testemailcodingmart@gmail.com",
      pass: "testemail123!"
    }
  });

  alertEmailAddressArray.map(emailTo => {
    var mailOptions = {
      from: "testemailcodingmart@gmail.com",
      to: emailTo.email,
      subject: "Alert! Logs are Exceeding!",
      text: "Alert! Logs are Exceeding. Let's scale up!"
    };

    transporter.sendMail(mailOptions, function(error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Email sent: " + info.response);
      }
    });
  });
}

// Watch File for Changes
function watchFile() {
  let fsWait = false;
  fs.watch(logFileLocation, (event, filename) => {
    if (filename) {
      if (fsWait) return;
      fsWait = setTimeout(() => {
        fsWait = false;
      }, 100);
      console.log(`${filename} file Changed`);
      streamData();
    }
  });
}

// Stream Logs
function streamData() {
  console.log("Streaming");
  var s = fs
    .createReadStream(logFileLocation)
    .pipe(es.split())
    .pipe(
      es
        .mapSync(function(line) {
          s.pause();
          if (readLine <= currentLine) {
            if (/^\s*$/.test(line)) {
              // console.log("Line is Blank");
            } else {
              regexGROKTest(line);
              logsCountPerSecond += 1;
            }
          }
          currentLine += 1;
          s.resume();
        })

        .on("error", function(err) {
          console.log("Error while reading file.", err);
        })
        .on("end", function() {
          readLine = currentLine;
          currentLine = 1;
          // console.log("Read entire file. No of Lines Read are ", readLine);
        })
    );
}

// regexGrokPattern
function regexGROKTest(str) {
  var newJSON = pattern.parseSync(str);

  if (newJSON) {
    let timestampFormatted = moment(
      newJSON.timestamp,
      "DD/MMM/YYYY:HH:mm:ss z"
    );
    newJSON.uid = uuidv1();
    newJSON.timestamp = timestampFormatted;
    const spiderBot = checkSpiderBot(newJSON.agent);
    if (spiderBot) {
      newJSON.spiderBot = spiderBot;
    }

    const parsedURL = regexURL(newJSON.url);
    if (parsedURL) newJSON = Object.assign(newJSON, parsedURL);
    addToIndex(newJSON);
  }
}

// Regex URL
function regexURL(url) {
  // console.log("Going to Regex");
  var UrlPattern = require("url-pattern");
  let newURL,
    parsedURL = {},
    isArabic = false;

  // Checking If Arabic or Not
  if (url.substr(0, 3) == "/ar") {
    newURL = url.replace(url.substr(0, 3), "");
    isArabic = true;
  } else {
    newURL = url;
  }
  // Splitting .html in the End
  const newURLWithoutHTML = newURL.split(".html");
  const newURLFinal = newURLWithoutHTML[0];
  // console.log(newURLFinal);
  // Pattern Match for URL
  var pattern = new UrlPattern("/:flight-:type/:airlineInfo");
  parsedURL = pattern.match(newURLFinal);

  // If URL Contains AMP/Widget
  if (!parsedURL) {
    var pattern = new UrlPattern("/:flight-:type/:webpageType/:airlineInfo");
    parsedURL = pattern.match(newURLFinal);
    // console.log(parsedURL);
  }
  // console.log("Parsed URL ", parsedURL);

  if (parsedURL) {
    if (parsedURL.airlineInfo) {
      // Console.log
      // console.log("Going to AirlineInfo ", parsedURL.airlineInfo);

      // Airline Information (Ex: Flight Name, Destination, Arrival City)
      const airlineInfo = parsedURL.airlineInfo;

      // Assign Airline Info to Object
      const airlineName = airlineInfo.split("-airlines");
      parsedURL.airlineName = airlineName[0];
      // console.log(airlineInfo);

      // Checking the Type of the URL
      switch (parsedURL.type) {
        case "booking": {
          const actionType = checkActionType(airlineInfo);
          if (actionType) {
            parsedURL.actionType = actionType;
          } else {
            // For Airline Routes
            parsedURL.actionType = "route";
          }
          break;
        }

        case "schedule":
          const actionType = checkActionType(airlineInfo);
          // console.log("Schedule");
          break;
        case "tickets":
          // console.log("Tickets");
          break;

        default:
          console.log("No Type");
      }
    }
    // If Arabic or Not
    parsedURL.isArabic = isArabic;
    return parsedURL;
  }
}

// Check Action Type (i.e Route, PNR STATUS, Check-in)
function checkActionType(airlineInfo) {
  let actionType = "route";

  if (airlineInfo.includes("pnr-status")) {
    actionType = "pnrStatus";
  }
  // For Web Check In
  else if (airlineInfo.includes("check-in")) {
    actionType = "checkIn";
  }
  // For Customer Support
  else if (airlineInfo.includes("customer-support")) {
    actionType = "customerSupport";
  }
  // For Baggages
  else if (airlineInfo.includes("baggages")) {
    actionType = "baggages";
  }
  // For Domestic Airlines
  else if (airlineInfo.includes("domestic-airlines")) {
    actionType = "domesticAirlines";
  }
  // For Internation Airlines
  else if (airlineInfo.includes("international-airlines")) {
    actionType = "internationalAirlines";
  }
  // For Domestic
  else if (airlineInfo.includes("domestic")) {
    actionType = "domestic";
  } // For International
  else if (airlineInfo.includes("international")) {
    actionType = "international";
  }
  // For Domestic Airports
  else if (airlineInfo.includes("domestic-airports")) {
    actionType = "domesticAirports";
  } // For International Airports
  else if (airlineInfo.includes("international-airports")) {
    actionType = "internationalAirports";
  }

  return actionType;
}

// Detect Spider Bots
function checkSpiderBot(agent) {
  let spiderBot;
  // If Google Bot
  if (agent.includes("Googlebot")) {
    spiderBot = "Googlebot";
  }
  // If bingbot Bot
  if (agent.includes("bingbot")) {
    spiderBot = "bingbot";
  }
  // If DuckDuckBot Bot
  if (agent.includes("DuckDuckBot")) {
    spiderBot = "DuckDuckBot";
  }
  // If Baiduspider Bot
  if (agent.includes("Baiduspider")) {
    spiderBot = "Baiduspider";
  }
  // If YandexBot Bot
  if (agent.includes("YandexBot")) {
    spiderBot = "YandexBot";
  }
  // If facebookexternalhit Bot
  if (agent.includes("facebookexternalhit")) {
    spiderBot = "facebookexternalhit";
  }
  // If DotBot Bot
  if (agent.includes("DotBot")) {
    spiderBot = "DotBot";
  }
  // If SemrushBot Bot
  if (agent.includes("SemrushBot")) {
    spiderBot = "SemrushBot";
  }
  // If AhrefsBot Bot
  if (agent.includes("AhrefsBot")) {
    spiderBot = "AhrefsBot";
  }

  // If AdsBot-Google Bot
  if (agent.includes("AdsBot-Google")) {
    spiderBot = "AdsBotGoogle";
  }

  return spiderBot;
}

async function addToIndex(data) {
  await client
    .create({
      index: "logsindexnew",
      type: "log",
      id: data.uid,
      body: data
    })
    .then(log => {
      console.log(log);
    });
}

function getStreamAndEmit(newJSON) {
  console.log("Emitting");
  io.emit("FromAPI", newJSON);
}

server.listen(port, () => console.log(`Listening on port ${port}`));
app.listen(3300, () => console.log("Server is Listening at 3300"));
