// TEST-ONLY: bundled ahead of src/studio.js in the waiting-state page, so the page checks data modules with Story Block's
// checker but has no runtime. The shipped distribution never includes this file.
import { useBackendForTests } from '../../src/data-modules/sb-adapter.js';
import { noRuntimeBackend } from './dm-backends.js';

useBackendForTests(noRuntimeBackend);
