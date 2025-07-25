const { join } = require("path");
/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Chrome kommt in ./cache/puppeteer und wird so ins Runtime‑Image kopiert
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
