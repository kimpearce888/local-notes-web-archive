// Global unit-test setup.
// fake-indexeddb/auto installs structuredClone-backed IndexedDB globals for
// repository/migration tests. It is inert for tests that do not touch IndexedDB.
import 'fake-indexeddb/auto';
