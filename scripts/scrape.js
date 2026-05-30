#!/usr/bin/env node

// Deprecated. Listing discovery now lives in scripts/discover-listings.js,
// which reads your OLX user page(s), filters by keyword, and writes
// product-links.txt. This shim just forwards to it so old commands keep working.

require('./discover-listings.js');
