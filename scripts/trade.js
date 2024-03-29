const hre = require("hardhat");
const fs = require("fs");
var Web3 = require('web3');
var Accounts = require('web3-eth-accounts');
require('dotenv').config();
var colors = require("colors");

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
  let wrappedNativeTokenSymple;
  let str_log;
  
  if (network === 'aurora') wrappedNativeTokenSymple = "WETH";
  if (network === 'fantom') wrappedNativeTokenSymple = "WFTM";
  if (network === 'bsc') wrappedNativeTokenSymple = "WBNB";
  if (network === 'polygon') wrappedNativeTokenSymple = "WMATIC";

  if (config.routes.length > 0) {
    targetRoute = useGoodRoutes();
  } else {
    targetRoute = searchForRoutes();
  }
  try {
    let tradeSize = balances[targetRoute.token1].balance;
    if ((tradeSize / 10 ** 18).toFixed(5) < 0.001) {
      str_log = "!!! Insufficient " + wrappedNativeTokenSymple + ". Please charge some " + wrappedNativeTokenSymple + " for trading";
      console.log(str_log.red);
      process.exit();
    }
    
    str_log = "Trading Input Amount: ".green + (tradeSize / 10 ** 18).toFixed(5).yellow + " " + wrappedNativeTokenSymple.green;
    console.log(str_log);

    const amtBack = await arb.estimateDualDexTrade(targetRoute.router1, targetRoute.router2, targetRoute.token1, targetRoute.token2, tradeSize);

    str_log = "Expected Output Amount: ".green + (amtBack / 10 ** 18).toFixed(5).yellow + " " + wrappedNativeTokenSymple.green;
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
