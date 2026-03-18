import readline from 'readline';
import chalk from 'chalk';
import { setAuth } from './api.js';
import { startSSE, setEventPrinter } from './sse.js';
import { startRepl } from './repl.js';
import { fetchHealth } from './api.js';
import { DEFAULT_PLAYERS, SERVER_URL } from './config.js';
import { fmtEvent } from './format.js';

function banner() {
  console.log(chalk.bold.cyan('╔════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║') + chalk.bold('  SiliconWorld CLI  v0.1        ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════╝'));
  console.log(chalk.dim(`Server: ${SERVER_URL}`));
  console.log('');
}

async function checkServer(): Promise<boolean> {
  try {
    const h = await fetchHealth();
    console.log(chalk.green(`✓ Server online`) + chalk.dim(`  status=${h.status}  tick=${h.tick}`));
    return true;
  } catch {
    console.log(chalk.red('✗ Cannot reach server at ') + SERVER_URL);
    console.log(chalk.dim('  Start server or set SW_SERVER env var'));
    return false;
  }
}

async function selectPlayer(): Promise<{ id: string; key: string }> {
  return new Promise(resolve => {
    console.log('\nSelect player:');
    DEFAULT_PLAYERS.forEach((p, i) => {
      console.log(`  [${i + 1}] ${p.id} (${p.key})`);
    });
    console.log(`  [${DEFAULT_PLAYERS.length + 1}] Custom key`);
    console.log('');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const ask = () => {
      rl.question('> ', async (answer) => {
        const n = parseInt(answer.trim(), 10);
        if (n >= 1 && n <= DEFAULT_PLAYERS.length) {
          rl.close();
          resolve(DEFAULT_PLAYERS[n - 1]);
        } else if (n === DEFAULT_PLAYERS.length + 1) {
          rl.question('Player ID: ', (id) => {
            rl.question('Player Key: ', (key) => {
              rl.close();
              resolve({ id: id.trim(), key: key.trim() });
            });
          });
        } else {
          console.log(chalk.red('Invalid choice, try again.'));
          ask();
        }
      });
    };

    ask();
  });
}

async function main() {
  banner();

  const online = await checkServer();
  if (!online) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>(resolve => {
      rl.question(chalk.yellow('Continue anyway? [y/N] '), (ans) => {
        rl.close();
        if (ans.trim().toLowerCase() !== 'y') {
          process.exit(1);
        }
        resolve();
      });
    });
  }

  const player = await selectPlayer();
  setAuth(player.id, player.key);

  console.log(chalk.green(`\nLogged in as ${player.id}. Type "help" for commands.\n`));

  // Set up SSE event printer (prints above prompt)
  setEventPrinter((evt) => {
    process.stdout.write('\r\x1B[K'); // clear current line
    console.log(chalk.dim('[SSE] ') + fmtEvent(evt));
    // Re-display prompt on next tick after readline handles it
  });

  // Start SSE background listener
  startSSE(player.key);

  // Handle graceful exit
  process.on('SIGINT', () => {
    console.log(chalk.dim('\nGoodbye!'));
    process.exit(0);
  });

  // Start REPL
  startRepl(player.id);
}

main().catch(err => {
  console.error(chalk.red('Fatal error: ') + err);
  process.exit(1);
});
