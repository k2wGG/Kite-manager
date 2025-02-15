import fetch from 'node-fetch';
import chalk from 'chalk';
import readline from 'readline';
import fs from 'fs/promises';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Файл, где будем хранить данные по эндпоинтам и вопросам.
 */
const ENDPOINTS_FILE = 'endpoints.json';

/**
 * Функция для вывода логотипа (пример).
 */
function showLogo() {
  console.log(chalk.yellow(`
  _   _           _  _____      
 | \\ | |         | ||____ |     
 |  \\| | ___   __| |    / /_ __ 
 | . \` |/ _ \\ / _\` |    \\ \\ '__|
 | |\\  | (_) | (_| |.___/ / |   
 \\_| \\_/\\___/ \\__,_|\\____/|_|   
                                
 Hyperlane Node Manager — скрипт для автоматики @Nod3r
`));
}

/**
 * Функция для запроса ввода от пользователя (простой "prompt").
 * @param {string} query - Вопрос для пользователя.
 * @returns {Promise<string>}
 */
function askQuestion(query) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Глобальная переменная, где храним эндпоинты, считанные из endpoints.json.
 * Структура:
 * {
 *   "https://endpoint-url": {
 *     "agent_id": "...",
 *     "name": "...",
 *     "questions": [...]
 *   },
 *   ...
 * }
 */
let endpointsData = {};

/**
 * Загрузка данных из файла endpoints.json.
 * Если файла нет, можно создать дефолтный.
 */
async function loadEndpoints() {
  try {
    const data = await fs.readFile(ENDPOINTS_FILE, 'utf8');
    endpointsData = JSON.parse(data);
    console.log(chalk.green(`[OK] Данные эндпоинтов загружены из ${ENDPOINTS_FILE}`));
  } catch (err) {
    console.log(chalk.yellow(`[ИНФО] Не удалось прочитать ${ENDPOINTS_FILE}. Будет создан новый файл.`));
    // Если нужно — здесь можно задать дефолтный набор эндпоинтов:
    endpointsData = {
      "https://deployment-uu9y1z4z85rapgwkss1muuiz.stag-vxzy.zettablock.com/main": {
        "agent_id": "deployment_UU9y1Z4Z85RAPGwkss1mUUiZ",
        "name": "Ассистент Kite AI",
        "questions": []
      },
      "https://deployment-ecz5o55dh0dbqagkut47kzyc.stag-vxzy.zettablock.com/main": {
        "agent_id": "deployment_ECz5O55dH0dBQaGKuT47kzYC",
        "name": "Ассистент по криптовалютным ценам",
        "questions": []
      },
      "https://deployment-sofftlsf9z4fya3qchykaanq.stag-vxzy.zettablock.com/main": {
        "agent_id": "deployment_SoFftlsf9z4fyA3QCHYkaANq",
        "name": "Анализатор транзакций",
        "questions": []
      }
    };
    await saveEndpoints(); // Создаём файл сразу
  }
}

/**
 * Сохранение текущего состояния endpointsData в endpoints.json.
 */
async function saveEndpoints() {
  try {
    await fs.writeFile(ENDPOINTS_FILE, JSON.stringify(endpointsData, null, 2), 'utf8');
    console.log(chalk.green(`[OK] Данные эндпоинтов сохранены в ${ENDPOINTS_FILE}`));
  } catch (err) {
    console.log(chalk.red(`[ОШИБКА] Не удалось сохранить ${ENDPOINTS_FILE}: ${err.message}`));
  }
}

/**
 * Загрузка кошельков из файла wallets.txt.
 * Если файл отсутствует, выбрасываем ошибку (пусть пользователь сам создаёт).
 */
async function loadWallets() {
  try {
    const data = await fs.readFile('wallets.txt', 'utf8');
    const wallets = data.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    if (wallets.length === 0) {
      throw new Error('В файле wallets.txt не найдено кошельков');
    }
    return wallets;
  } catch (err) {
    console.log(`${chalk.red('[ОШИБКА]')} Ошибка чтения файла wallets.txt: ${err.message}`);
    throw err;
  }
}

/**
 * Загрузка прокси из файла proxies.txt.
 * Если файл не найден – используем прямое подключение.
 */
async function loadProxies() {
  try {
    const data = await fs.readFile('proxies.txt', 'utf8');
    return data.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(proxy => {
        if (proxy.includes('://')) {
          const url = new URL(proxy);
          const protocol = url.protocol.replace(':', '');
          const auth = url.username ? `${url.username}:${url.password}` : '';
          const host = url.hostname;
          const port = url.port;
          return { protocol, host, port, auth };
        } else {
          const parts = proxy.split(':');
          let [protocol, host, port, user, pass] = parts;
          protocol = protocol.replace('//', '');
          const auth = user && pass ? `${user}:${pass}` : '';
          return { protocol, host, port, auth };
        }
      });
  } catch (err) {
    console.log(`${chalk.yellow('[ИНФО]')} Файл proxies.txt не найден или произошла ошибка чтения. Используется прямое подключение.`);
    return [];
  }
}

/**
 * Создание HTTP/SOCKS агента для работы через прокси.
 */
function createAgent(proxy) {
  if (!proxy) return null;

  const { protocol, host, port, auth } = proxy;
  const authString = auth ? `${auth}@` : '';
  const proxyUrl = `${protocol}://${authString}${host}:${port}`;

  return protocol.startsWith('socks')
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);
}

/**
 * Класс для хранения статистики взаимодействий кошелька.
 */
class WalletStatistics {
  constructor() {
    // Инициализируем счётчики по именам из endpointsData
    this.agentInteractions = {};
    for (const endpointUrl in endpointsData) {
      const agentName = endpointsData[endpointUrl].name;
      this.agentInteractions[agentName] = 0;
    }
    this.totalPoints = 0;
    this.totalInteractions = 0;
    this.lastInteractionTime = null;
    this.successfulInteractions = 0;
    this.failedInteractions = 0;
  }
}

/**
 * Класс сессии кошелька.
 */
class WalletSession {
  constructor(walletAddress, sessionId) {
    this.walletAddress = walletAddress;
    this.sessionId = sessionId;
    this.dailyPoints = 0;
    this.startTime = new Date();
    this.nextResetTime = new Date(this.startTime.getTime() + 24 * 60 * 60 * 1000);
    this.statistics = new WalletStatistics();
  }

  updateStatistics(agentName, success = true) {
    if (typeof this.statistics.agentInteractions[agentName] === 'undefined') {
      // Если вдруг не было такого агента в момент инициализации
      this.statistics.agentInteractions[agentName] = 0;
    }
    this.statistics.agentInteractions[agentName]++;
    this.statistics.totalInteractions++;
    this.statistics.lastInteractionTime = new Date();
    if (success) {
      this.statistics.successfulInteractions++;
      this.statistics.totalPoints += 10; // Очки за успешное взаимодействие
    } else {
      this.statistics.failedInteractions++;
    }
  }

  printStatistics() {
    console.log(`\n${chalk.blue(`[Сессия ${this.sessionId}]`)} ${chalk.green(`[${this.walletAddress}]`)} ${chalk.cyan('📊 Текущая статистика')}`);
    console.log(`${chalk.yellow('════════════════════════════════════════════')}`);
    console.log(`${chalk.cyan('💰 Всего очков:')} ${chalk.green(this.statistics.totalPoints)}`);
    console.log(`${chalk.cyan('🔄 Всего взаимодействий:')} ${chalk.green(this.statistics.totalInteractions)}`);
    console.log(`${chalk.cyan('✅ Успешно:')} ${chalk.green(this.statistics.successfulInteractions)}`);
    console.log(`${chalk.cyan('❌ Неудачно:')} ${chalk.red(this.statistics.failedInteractions)}`);
        console.log(`${chalk.cyan('⏱️ Последнее взаимодействие:')} ${chalk.yellow(this.statistics.lastInteractionTime ? this.statistics.lastInteractionTime.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false }) : 'Никогда')}`);
    console.log(`\n${chalk.cyan('🤖 Взаимодействия с агентами:')}`);
    for (const [agentName, count] of Object.entries(this.statistics.agentInteractions)) {
      console.log(`   ${chalk.yellow(agentName)}: ${chalk.green(count)}`);
    }
    console.log(chalk.yellow('════════════════════════════════════════════\n'));
  }
}

/**
 * Класс автоматизации взаимодействия.
 */
class KiteAIAutomation {
  constructor(walletAddress, proxyList = [], sessionId) {
    this.session = new WalletSession(walletAddress, sessionId);
    this.proxyList = proxyList;
    this.currentProxyIndex = 0;
    this.MAX_DAILY_POINTS = 200;
    this.POINTS_PER_INTERACTION = 10;
    this.MAX_DAILY_INTERACTIONS = this.MAX_DAILY_POINTS / this.POINTS_PER_INTERACTION;
    this.isRunning = true;
  }

  getCurrentProxy() {
    if (this.proxyList.length === 0) return null;
    return this.proxyList[this.currentProxyIndex];
  }

  rotateProxy() {
    if (this.proxyList.length === 0) return null;
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxyList.length;
    const proxy = this.getCurrentProxy();
    this.logMessage('🔄', `Переключение на прокси: ${proxy.protocol}://${proxy.host}:${proxy.port}`, 'cyan');
    return proxy;
  }

  logMessage(emoji, message, color = 'white') {
    const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour12: false });
    const sessionPrefix = chalk.blue(`[Сессия ${this.session.sessionId}]`);
    const walletPrefix = chalk.green(`[${this.session.walletAddress.slice(0, 6)}...]`);
    console.log(`${chalk.yellow(`[${timestamp}]`)} ${sessionPrefix} ${walletPrefix} ${chalk[color](`${emoji} ${message}`)}`);
  }

  resetDailyPoints() {
    const currentTime = new Date();
    if (currentTime >= this.session.nextResetTime) {
      this.logMessage('✨', 'Начало нового 24-часового периода начисления очков', 'green');
      this.session.dailyPoints = 0;
      this.session.nextResetTime = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000);
      return true;
    }
    return false;
  }

  async shouldWaitForNextReset() {
    if (this.session.dailyPoints >= this.MAX_DAILY_POINTS) {
      const waitSeconds = (this.session.nextResetTime - new Date()) / 1000;
      if (waitSeconds > 0) {
        this.logMessage('🎯', `Достигнуто максимальное количество очков за день (${this.MAX_DAILY_POINTS})`, 'yellow');
        this.logMessage('⏳', `Следующий сброс: ${this.session.nextResetTime.toISOString().replace('T', ' ').slice(0, 19)}`, 'yellow');
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
        this.resetDailyPoints();
      }
      return true;
    }
    return false;
  }

  async getRecentTransactions() {
    this.logMessage('🔍', 'Сканирование недавних транзакций...', 'white');
    const url = 'https://testnet.kitescan.ai/api/v2/advanced-filters';
    const params = new URLSearchParams({
      transaction_types: 'coin_transfer',
      age: '5m'
    });

    try {
      const agent = createAgent(this.getCurrentProxy());
      const response = await fetch(`${url}?${params}`, {
        agent,
        headers: {
          'accept': '*/*',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      const data = await response.json();
      const hashes = data.items?.map(item => item.hash) || [];
      this.logMessage('📊', `Найдено ${hashes.length} недавних транзакций`, 'magenta');
      return hashes;
    } catch (e) {
      this.logMessage('❌', `Ошибка получения транзакций: ${e}`, 'red');
      this.rotateProxy();
      return [];
    }
  }

  /**
   * Отправка запроса к AI.
   * endpoint — это ключ (URL) из endpointsData
   */
  async sendAiQuery(endpoint, message) {
    const agent = createAgent(this.getCurrentProxy());
    const headers = {
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    const data = {
      message,
      stream: true
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        agent,
        headers,
        body: JSON.stringify(data)
      });

      const sessionPrefix = chalk.blue(`[Сессия ${this.session.sessionId}]`);
      const walletPrefix = chalk.green(`[${this.session.walletAddress.slice(0, 6)}...]`);
      process.stdout.write(`${sessionPrefix} ${walletPrefix} ${chalk.cyan('🤖 Ответ ИИ: ')}`);

      let accumulatedResponse = "";

      for await (const chunk of response.body) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6);
              if (jsonStr === '[DONE]') break;
              const jsonData = JSON.parse(jsonStr);
              const content = jsonData.choices?.[0]?.delta?.content || '';
              if (content) {
                accumulatedResponse += content;
                process.stdout.write(chalk.magenta(content));
              }
            } catch (e) {
              continue;
            }
          }
        }
      }
      console.log();
      return accumulatedResponse.trim();
    } catch (e) {
      this.logMessage('❌', `Ошибка запроса ИИ: ${e}`, 'red');
      this.rotateProxy();
      return "";
    }
  }

  async reportUsage(endpoint, message, response) {
    this.logMessage('📝', 'Запись взаимодействия...', 'white');

    // Достаем agent_id из endpointsData
    const agent_id = endpointsData[endpoint].agent_id;

    const url = 'https://quests-usage-dev.prod.zettablock.com/api/report_usage';
    const data = {
      wallet_address: this.session.walletAddress,
      agent_id,
      request_text: message,
      response_text: response,
      request_metadata: {}
    };

    try {
      const agent = createAgent(this.getCurrentProxy());
      const result = await fetch(url, {
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify(data)
      });
      return result.status === 200;
    } catch (e) {
      this.logMessage('❌', `Ошибка отчета о взаимодействии: ${e}`, 'red');
      this.rotateProxy();
      return false;
    }
  }

  async run() {
    this.logMessage('🚀', 'Инициализация системы автоматического взаимодействия Kite AI', 'green');
    this.logMessage('💼', `Кошелек: ${this.session.walletAddress}`, 'cyan');
    this.logMessage('🎯', `Дневная цель: ${this.MAX_DAILY_POINTS} очков (${this.MAX_DAILY_INTERACTIONS} взаимодействий)`, 'cyan');
    this.logMessage('⏰', `Следующий сброс: ${this.session.nextResetTime.toISOString().replace('T', ' ').slice(0, 19)}`, 'cyan');

    if (this.proxyList.length > 0) {
      this.logMessage('🌐', `Загружено ${this.proxyList.length} прокси`, 'cyan');
    } else {
      this.logMessage('🌐', 'Работа в режиме прямого подключения', 'yellow');
    }

    let interactionCount = 0;
    try {
      while (this.isRunning) {
        this.resetDailyPoints();
        await this.shouldWaitForNextReset();

        interactionCount++;
        console.log(`\n${chalk.blue(`[Сессия ${this.session.sessionId}]`)} ${chalk.green(`[${this.session.walletAddress}]`)} ${chalk.cyan('═'.repeat(60))}`);
        this.logMessage('🔄', `Взаимодействие №${interactionCount}`, 'magenta');
        this.logMessage('📈', `Прогресс: ${this.session.dailyPoints + this.POINTS_PER_INTERACTION}/${this.MAX_DAILY_POINTS} очков`, 'cyan');
        this.logMessage('⏳', `Следующий сброс: ${this.session.nextResetTime.toISOString().replace('T', ' ').slice(0, 19)}`, 'cyan');

        const transactions = await this.getRecentTransactions();
        // Обновляем вопросы для "Анализатора транзакций" на основе найденных транзакций
        if (endpointsData["https://deployment-sofftlsf9z4fya3qchykaanq.stag-vxzy.zettablock.com/main"]) {
          endpointsData["https://deployment-sofftlsf9z4fya3qchykaanq.stag-vxzy.zettablock.com/main"].questions =
            transactions.map(tx => `Проанализируйте эту транзакцию подробно: ${tx}`);
        }

        // Выбираем случайный эндпоинт
        const allEndpoints = Object.keys(endpointsData);
        const endpoint = allEndpoints[Math.floor(Math.random() * allEndpoints.length)];
        const endpointObj = endpointsData[endpoint];
        const questions = endpointObj.questions;

        if (!questions || questions.length === 0) {
          this.logMessage('⚠️', `У эндпоинта "${endpointObj.name}" нет вопросов для запроса. Пропускаем.`, 'red');
          continue;
        }

        const question = questions[Math.floor(Math.random() * questions.length)];

        this.logMessage('🤖', `Система ИИ: ${endpointObj.name}`, 'cyan');
        this.logMessage('🔑', `ID агента: ${endpointObj.agent_id}`, 'cyan');
        this.logMessage('❓', `Запрос: ${question}`, 'cyan');

        const response = await this.sendAiQuery(endpoint, question);
        let interactionSuccess = false;

        if (await this.reportUsage(endpoint, question, response)) {
          this.logMessage('✅', 'Взаимодействие успешно зарегистрировано', 'green');
          this.session.dailyPoints += this.POINTS_PER_INTERACTION;
          interactionSuccess = true;
        } else {
          this.logMessage('⚠️', 'Не удалось зарегистрировать взаимодействие', 'red');
        }

        // Обновляем статистику для данного взаимодействия
        this.session.updateStatistics(endpointObj.name, interactionSuccess);
        this.session.printStatistics();

        // Задержка перед следующим запросом
        const delay = Math.random() * 2 + 1;
        this.logMessage('⏳', `Ожидание: ${delay.toFixed(1)} секунд...`, 'yellow');
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        this.logMessage('🛑', 'Процесс завершен пользователем', 'yellow');
      } else {
        this.logMessage('❌', `Ошибка: ${e}`, 'red');
      }
    }
  }

  stop() {
    this.isRunning = false;
  }
}

/**
 * Меню для управления кошельками (wallets.txt).
 */
async function manageWallets() {
  console.clear();
  console.log(chalk.green('=== Управление кошельками ==='));
  let wallets = [];
  try {
    const data = await fs.readFile('wallets.txt', 'utf8');
    wallets = data.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    console.log(chalk.cyan('Текущий список кошельков:'));
    wallets.forEach((w, i) => console.log(`${i + 1}. ${w}`));
  } catch (err) {
    console.log(chalk.yellow('Файл wallets.txt не найден. Он будет создан при сохранении.'));
  }

  const action = await askQuestion('Выберите действие: [1] Перезаписать список, [2] Добавить новые кошельки, [0] Выход: ');
  if (action === '0') return;

  let newWallets = [];
  console.log(chalk.cyan('Введите кошельки (каждый с новой строки). Для завершения введите пустую строку.'));
  while (true) {
    const wallet = await askQuestion('> ');
    if (!wallet) break;
    newWallets.push(wallet);
  }

  if (action === '1') {
    await fs.writeFile('wallets.txt', newWallets.join('\n') + '\n', 'utf8');
    console.log(chalk.green('Список кошельков перезаписан.'));
  } else if (action === '2') {
    const updatedList = wallets.concat(newWallets);
    await fs.writeFile('wallets.txt', updatedList.join('\n') + '\n', 'utf8');
    console.log(chalk.green('Новые кошельки добавлены.'));
  }
  await askQuestion('Нажмите Enter для возврата в главное меню...');
}

/**
 * Меню для редактирования списка вопросов для ботов (endpointsData).
 */
async function manageQuestions() {
  console.clear();
  console.log(chalk.green('=== Редактирование вопросов для ботов ==='));
  const allEndpoints = Object.keys(endpointsData);
  if (allEndpoints.length === 0) {
    console.log(chalk.yellow('Нет ни одного эндпоинта в endpointsData. Добавьте вручную или в коде.'));
    await askQuestion('Нажмите Enter для возврата в главное меню...');
    return;
  }

  // Выводим список
  allEndpoints.forEach((url, index) => {
    console.log(`${index + 1}. ${endpointsData[url].name} (${url})`);
  });

  const choice = await askQuestion('Выберите номер системы для редактирования вопросов (или 0 для выхода): ');
  const idx = parseInt(choice);
  if (isNaN(idx) || idx < 1 || idx > allEndpoints.length) {
    console.log(chalk.yellow('Неверный выбор. Возврат в меню.'));
    return;
  }

  const selectedUrl = allEndpoints[idx - 1];
  const selectedObj = endpointsData[selectedUrl];
  console.log(chalk.cyan(`Текущий список вопросов для "${selectedObj.name}":`));
  if (!selectedObj.questions || selectedObj.questions.length === 0) {
    console.log(chalk.yellow('Список вопросов пуст.'));
  } else {
    selectedObj.questions.forEach((q, i) => console.log(`${i + 1}. ${q}`));
  }

  console.log(chalk.cyan('\nВведите новый список вопросов. Каждый вопрос с новой строки. Для завершения введите пустую строку.'));
  let newQuestions = [];
  while (true) {
    const question = await askQuestion('> ');
    if (!question) break;
    newQuestions.push(question);
  }
  selectedObj.questions = newQuestions;
  console.log(chalk.green('Список вопросов обновлён.'));

  // Сохраняем изменения в endpoints.json
  await saveEndpoints();

  await askQuestion('Нажмите Enter для возврата в главное меню...');
}

/**
 * Функция для запуска автоматизации.
 */
async function runAutomation() {
  console.clear();
  console.log(chalk.green('=== Запуск автоматизации ==='));
  let wallets, proxyList;
  try {
    wallets = await loadWallets();
  } catch (err) {
    console.log(chalk.red('Не удалось загрузить кошельки. Проверьте файл wallets.txt.'));
    await askQuestion('Нажмите Enter для возврата в главное меню...');
    return;
  }
  proxyList = await loadProxies();
  console.log(`${chalk.cyan('📊 Загружено:')} ${chalk.green(wallets.length)} кошельков и ${chalk.green(proxyList.length)} прокси\n`);

  // Создаём экземпляры для каждого кошелька
  const instances = wallets.map((wallet, index) =>
    new KiteAIAutomation(wallet, proxyList, index + 1)
  );

  console.log(chalk.cyan('\n════════════════════════'));
  console.log(chalk.cyan('🤖 Запуск всех сессий'));
  console.log(chalk.cyan('════════════════════════\n'));
  console.log(chalk.yellow('Для остановки работы используйте Ctrl+C.'));

  try {
    // Параллельно запускаем все экземпляры
    await Promise.all(instances.map(instance => instance.run()));
  } catch (error) {
    console.log(`\n${chalk.red('❌ Фатальная ошибка:')} ${error.message}`);
  }
}

/**
 * Главное меню приложения.
 */
async function mainMenu() {
  // Перед началом загружаем endpoints.json (если есть)
  await loadEndpoints();

  while (true) {
    console.clear();
    showLogo();
    console.log(chalk.green('=== Главное меню ==='));
    console.log('1. Управление кошельками (wallets.txt)');
    console.log('2. Редактировать список вопросов для ботов (endpoints.json)');
    console.log('3. Запустить автоматизацию');
    console.log('0. Выход');
    const choice = await askQuestion('Ваш выбор: ');
    if (choice === '1') {
      await manageWallets();
    } else if (choice === '2') {
      await manageQuestions();
    } else if (choice === '3') {
      await runAutomation();
      await askQuestion('Нажмите Enter для возврата в главное меню...');
    } else if (choice === '0') {
      console.log(chalk.blue('Выход из программы.'));
      process.exit(0);
    } else {
      console.log(chalk.yellow('Неверный выбор.'));
      await askQuestion('Нажмите Enter для продолжения...');
    }
  }
}

// Обработка сигнала завершения (Ctrl+C)
process.on('SIGINT', () => {
  console.log(`\n${chalk.yellow('🛑 Завершается работа...')}`);
  process.exit(0);
});

// Глобальный обработчик ошибок
process.on('unhandledRejection', (error) => {
  console.error(`\n${chalk.red('❌ Необработанное отклонение:')} ${error.message}`);
});

/**
 * Точка входа.
 */
mainMenu().catch(error => {
  console.error(`\n${chalk.red('❌ Фатальная ошибка:')} ${error.message}`);
  process.exit(1);
});
