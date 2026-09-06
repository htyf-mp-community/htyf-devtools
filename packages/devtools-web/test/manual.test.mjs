import {createWebDevTools} from '../src/index.ts';
import {testManualReporter} from '../../test/manual-reporter.mjs';

testManualReporter(createWebDevTools);
