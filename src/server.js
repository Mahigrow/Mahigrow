'use strict';
const app  = require('./app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`MahiGrow API running on port ${PORT}`);
  console.log('Starting Container');
});