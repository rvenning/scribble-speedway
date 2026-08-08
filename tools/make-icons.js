// Generate icons/ — a pencil-drawn loop of track on a green field.
// Run: node tools/make-icons.js  (from the scribble-speedway folder)
const fs = require("fs");
const path = require("path");
const { makeCanvas, downsample, encodePNG } = require("../lib/tools/png.js");

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });

function paint(size, pad) {
  const SS = 4, big = size * SS;
  const cv = makeCanvas(big);
  const u = big / 100;

  const GRASS = "#6cb44e", GRASS2 = "#7cc45a";
  const ROAD = "#4d5661", VERGE = "#e8e2cf", LINE = "#ffe9a8";
  const CAR = "#ff4d5e", TRIM = "#ffc23d";

  cv.fillRect(0, 0, big, big, GRASS);
  for (let x = 0; x < 100; x += 16) cv.fillRect(x * u, 0, 8 * u, big, GRASS2);

  const s = pad ? 0.76 : 1;
  const at = (v) => 50 * u + (v - 50) * u * s;
  const sz = (v) => v * u * s;

  // A rounded loop, drawn as a ring of stamped discs — the same shape the game
  // makes of a scribble, and the cheapest way to get round joins out of a
  // canvas with no stroke API.
  const ring = (rx, ry, w, colour) => {
    for (let a = 0; a < 360; a += 2) {
      const r = (a * Math.PI) / 180;
      cv.fillCircle(at(50 + Math.cos(r) * rx), at(50 + Math.sin(r) * ry), sz(w / 2), colour);
    }
  };
  ring(31, 25, 26, VERGE);
  ring(31, 25, 20, ROAD);

  // dashed centre line
  for (let a = 0; a < 360; a += 18) {
    const r = (a * Math.PI) / 180;
    cv.fillCircle(at(50 + Math.cos(r) * 31), at(50 + Math.sin(r) * 25), sz(1.5), LINE);
  }

  // start/finish chequer at the top of the loop
  for (let i = 0; i < 5; i++) {
    cv.fillRect(at(50 - 10 + i * 4), at(22), sz(4), sz(4), i % 2 ? "#ffffff" : "#1b1b1b");
    cv.fillRect(at(50 - 10 + i * 4), at(26), sz(4), sz(4), i % 2 ? "#1b1b1b" : "#ffffff");
  }

  // a little car on the right-hand straight
  cv.fillRect(at(75), at(44), sz(9), sz(15), CAR);
  cv.fillRect(at(75), at(44), sz(9), sz(4), TRIM);
  cv.fillRect(at(77), at(49), sz(5), sz(6), "#141a22");

  return encodePNG(size, size, downsample(cv.px, big, SS));
}

fs.writeFileSync(path.join(OUT, "icon-192.png"), paint(192, false));
fs.writeFileSync(path.join(OUT, "icon-512.png"), paint(512, false));
fs.writeFileSync(path.join(OUT, "maskable-512.png"), paint(512, true));
console.log("icons written to", OUT);
