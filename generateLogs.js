const fs = require("fs");
function apendLog() {
  fs.appendFile("public/test.txt", "\n", function(err) {
    if (err) throw err;
  });
  fs.appendFile(
    "public/test.txt",
    `14.141.162.161 - - [12/Dec/2018:09:08:51 +0000] "GET /ar/flight-booking/lion-airlines-jakarta-merauke-flights.html HTTP/1.1" 301 832 "-" "Mozilla/5.0 (compatible; AhrefsBot/5.2; +http://ahrefs.com/robot/)"`,
    function(err) {
      if (err) {
        console.log("error");
      }
    }
  );
}
function intervalFunc() {
  var random = Math.floor(Math.random() * Math.floor(700));
  console.log(random);
  var i;
  for (i = 0; i < random; i++) {
    apendLog();
  }
}
setInterval(intervalFunc, 1000);
