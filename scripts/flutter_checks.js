'use strict';
const { runFlutter } = require('./flutter_tool');
runFlutter(['analyze', '--no-pub']);
runFlutter(['test', '--no-pub']);
