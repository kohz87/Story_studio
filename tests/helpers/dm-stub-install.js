// TEST-ONLY: bundled ahead of src/studio.js in the stand-in distribution, so the page checks and simulates data
// modules with the stub backend. The shipped distribution never includes this file.
import { useBackendForTests } from '../../src/data-modules/sb-adapter.js';
import { backend } from './dm-stub-backend.js';

useBackendForTests(backend);
