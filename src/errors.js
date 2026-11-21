'use strict';

class ScrapeError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ScrapeError';
    this.code = code;
    this.status = status;
  }
}

module.exports = { ScrapeError };
