const { Transform } = require('stream')

class chunker extends Transform {
  constructor (size) {
    super();
    this.size = size;
    this.buffers = [];
    this.length = 0;
  }

  _transform (chunk, encoding, callback) {
    this.buffers.push(chunk);
    this.length += chunk.length;

    if (this.length >= this.size) {
      const all = Buffer.concat(this.buffers);
      for (let i = 0; i <= all.length - this.size; i += this.size) {
        this.push(all.slice(i, i + this.size));
      }

      const rest = all.slice(Math.floor(this.length / this.size) * this.size);
      this.buffers = [rest];
      this.length = rest.length;
    }

    callback();
  }

  _flush (callback) {
    callback();
  }
}

module.exports = chunker
