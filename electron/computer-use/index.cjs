/**
 * Klaw — Computer Use Agent
 * 
 * Main entry point. Import this to use the computer use feature.
 * 
 * Usage:
 *   const { ComputerUseAgent, vault } = require('./computer-use');
 *   
 *   const agent = new ComputerUseAgent();
 *   agent.on('step', ({ stepNum, thought }) => console.log(`Step ${stepNum}: ${thought}`));
 *   agent.on('done', ({ summary }) => console.log(`Done: ${summary}`));
 *   
 *   await agent.run("Open Notepad and type hello");
 */

const { ComputerUseAgent } = require('./agent.cjs');
const screen = require('./screen.cjs');
const vision = require('./vision.cjs');
const vault = require('./vault.cjs');

module.exports = {
  ComputerUseAgent,
  screen,
  vision,
  vault,
};


