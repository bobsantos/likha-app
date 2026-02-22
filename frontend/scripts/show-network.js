#!/usr/bin/env node

/**
 * show-network.js
 *
 * Prints a startup banner with the correct network URL for the Likha frontend.
 * Designed to run inside Docker before Next.js starts.
 *
 * Resolution order for the network IP:
 *   1. HOST_IP env var (most reliable in Docker — set by the user or a wrapper script)
 *   2. os.networkInterfaces() scan, filtering out loopback, Docker bridge (172.x),
 *      and Docker Desktop gateway (192.168.65.x)
 *
 * The displayed port comes from the HOST_PORT env var (set in docker-compose.yml)
 * so it reflects the host-side mapped port, not the container-internal port.
 */

'use strict';

const os = require('os');

const hostPort = process.env.HOST_PORT || '3000';
const hostIP   = (process.env.HOST_IP || '').trim();

/**
 * Return true if the IP is usable as a LAN address.
 */
function isUsableLanIP(ip) {
  if (ip.startsWith('127.'))        return false; // loopback
  if (ip.startsWith('172.'))        return false; // Docker bridge
  if (ip.startsWith('192.168.65.')) return false; // Docker Desktop gateway
  return true;
}

/**
 * Return the first usable IPv4 address from os.networkInterfaces().
 */
function getLocalNetworkIP() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (
        iface.family === 'IPv4' &&
        !iface.internal &&
        isUsableLanIP(iface.address)
      ) {
        return iface.address;
      }
    }
  }

  return null;
}

const networkIP = hostIP || getLocalNetworkIP();

const local   = `http://localhost:${hostPort}`;
const network = networkIP
  ? `http://${networkIP}:${hostPort}`
  : '(could not detect host IP — set HOST_IP in docker-compose.yml)';

console.log('\n  \x1b[1mLikha Frontend accessible at:\x1b[0m');
console.log(`    Local:   \x1b[36m${local}\x1b[0m`);
console.log(`    Network: \x1b[36m${network}\x1b[0m\n`);
