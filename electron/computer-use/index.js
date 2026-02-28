/**
 * Korvus — Computer Use Agent
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

const { ComputerUseAgent } = require('./agent');
const screen = require('./screen');
const vision = require('./vision');
const vault = require('./vault');

module.exports = {
  ComputerUseAgent,
  screen,
  vision,
  vault,
};
