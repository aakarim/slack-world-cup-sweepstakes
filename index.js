require('dotenv').config();
const x = require('x-ray')();
const TRIGGER_TIME = '10:00';
const RETRY_INTERVAL = 1000; // 1s retry
const INTERVAL = 60000; // 1 minute
const CHANNEL = /*process.env.CHANNEL*/ 'C3Y3QEV71';
const token = process.env.TOKEN;
let Slack = require('slack');
let slack = new Slack({ token });
const players = require('./players.json');
const countries = require('./countries.json');
const moment = require('moment');

function getPlayerFromTeam(team) {
  let p;
  Object.keys(players).some(player => {
    if (players[player].teams.includes(team)) {
      p = player;
      return true;
    }
  });
  return p;
}

function getPlayersFromTeams(teamArray) {
  const player1 = getPlayerFromTeam(teamArray[0]);
  const player2 = getPlayerFromTeam(teamArray[1]);
  return [player1, player2];
}

function convertSequenceToPairs(arr) {
  return arr.reduce((acc, current, i) => {
    if ((i + 1) % 2 === 0) {
      acc[acc.length - 1][1] = current;
      return acc;
    }
    // create new array
    return [...acc, [current]];
  }, [])
}

function getScoreOrTimeFromLive(live, scores, times) {
  let scorePtr = 0;
  let timePtr = 0;
  return live.reduce((acc, teamLive) => {
    if (teamLive) {
      const newAcc = [...acc, scores[scorePtr]];
      scorePtr++;
      return newAcc;
    }
    const newAcc = [...acc, times[timePtr]];
    timePtr++;
    return newAcc;
  }, []);
}

function removeInvalidCountries(teams) {
  return teams.reduce((acc, current) => {
    if (countries.findIndex(country => country.name === current.toUpperCase()) > -1) {
      return [...acc, current];
    }
    return acc;
  }, []);
}

async function getFixtures(date) {
  // get the world cup history
  const teamList = await new Promise((res, rej) => {
    x(
      `https://www.bbc.co.uk/sport/football/world-cup/scores-fixtures/${date}`,
      ['.gs-o-list-ui > li abbr']
    )((err, stuff) => {
      if (err) rej(err);
      res(stuff);
    });
  });
  // convert teamlist to teams
  const teams = convertSequenceToPairs(removeInvalidCountries(teamList));
  const scoresList = await new Promise((res, rej) => {
    x(
      `https://www.bbc.co.uk/sport/football/world-cup/scores-fixtures/${date}`,
      ['.sp-c-fixture__number--live']
    )((err, stuff) => {
      if (err) rej(err);
      res(stuff);
    });
  });
  // convert scoresList to scores
  const scores = convertSequenceToPairs(scoresList);

  // get all matches in play
  const liveRaw = await new Promise((res, rej) => {
    x(
      `https://www.bbc.co.uk/sport/football/world-cup/scores-fixtures/${date}`,
      ['.sp-c-fixture']
    )((err, stuff) => {
      if (err) rej(err);
      res(stuff);
    });
  });

  // check if there is 'mins'
  const live = liveRaw.map((l) => l.includes('mins') || l.includes('HT') || l.includes('ET'));

  const times = await new Promise((res, rej) => {
    x(
      `https://www.bbc.co.uk/sport/football/world-cup/scores-fixtures/${date}`,
      ['.sp-c-fixture__number--time']
    )((err, stuff) => {
      if (err) rej(err);
      res(stuff);
    });
  });
  const bbcLinks = await new Promise((res, rej) => {
    x(
      `https://www.bbc.co.uk/sport/football/world-cup/scores-fixtures/${date}`,
      ['.sp-c-fixture__block-link@href']
    )((err, stuff) => {
      if (err) rej(err);
      res(stuff);
    });
  });
  const status = getScoreOrTimeFromLive(live, scores, times);

  console.log('teams, times, scores,  bbcLinks, live, status', teams, times, scores, bbcLinks, live, status);
  const fixtures = teams.map((teamPair, i) => ({
    time: !live[i] && status[i], // only show time if not live (limitation on bbc site)
    teams: teamPair,
    live: live[i],
    score: live[i] && status[i], // only have score if live
    players: getPlayersFromTeams(teamPair),
    bbcLink: bbcLinks[i]
  }));
  // add scores and times on after

  console.log('fixtures', fixtures);
  return fixtures;
}

function getPlayerCountryImage(playerCountry) {
  return countries.find(country => country.name === playerCountry.toUpperCase())
    .image;
}

function createFixturesMessage(fixtures) {
  // each match is an attachment
  const attachments = fixtures.map(match => ({
    fallback: `${match.players[0]} v ${match.players[1]}`,
    color: '#36a64f',
    author_name: match.bbcLink && 'Visit match overview',
    author_link: match.bbcLink,
    author_icon: 'https://png.icons8.com/metro/1600/bbc-logo.png',
    title: `${match.players[0]} v ${match.players[1]}`,
    title_link: match.bbcLink,
    text: `${match.teams[0]} v ${match.teams[1]}`,
    fields: [
      {
        title: 'Time',
        value: match.time,
        short: false
      }
    ],
    // image_url: getPlayerCountryImage(match.teams[0]),
    // thumb_url: getPlayerCountryImage(match.teams[0]),
    footer: 'World Cup Bot',
    footer_icon: 'https://api.fifa.com/api/v1/picture/tournaments-sq-4/254645_w'
  }));
  return {
    text: "Today's fixtures",
    attachments: attachments
  };
}

async function sendError(e) {
  await slack.chat.postMessage({
    token,
    channel: '@adil.karim',
    text: e.message
  });
}

async function createMatchStartMessage(matches) {
  const attachments = matches.map((match) => ({
    fallback: `${match.players[0]} v ${match.players[1]}`,
    color: '#36a64f',
    author_name: match.bbcLink && 'Visit match overview',
    author_link: match.bbcLink,
    author_icon: 'https://png.icons8.com/metro/1600/bbc-logo.png',
    title: `${match.players[0]} v ${match.players[1]}`,
    title_link: match.bbcLink,
    text: `${match.teams[0]} v ${match.teams[1]}`,
    // image_url: getPlayerCountryImage(match.teams[0]),
    // thumb_url: getPlayerCountryImage(match.teams[0]),
    footer: 'World Cup Bot',
    footer_icon: 'https://api.fifa.com/api/v1/picture/tournaments-sq-4/254645_w'
  }));
  return {
    text: "Kickoff!",
    attachments,
  }
}

async function sendMatchStartReminder(date, time) {
  try {
    const fixtures = await getFixtures(date);
    const matchesAboutToStart = fixtures.filter(fixture => fixture.time === time);
    // any matches about to start?
    if (matchesAboutToStart.length > 0) {
      console.log('matches about to start!');
      // if so then send a message
      const message = await createMatchStartMessage(matchesAboutToStart);
      const response = await slack.chat.postMessage({
        token,
        channel: CHANNEL,
        ...message
      });
      console.log('post match start message response', response);
    }
  } catch (e) {
    console.log(e);
    await sendError(e);
  }
}

async function sendFixtures(date, time) {
  const fixtures = await getFixtures(date);
  if (fixtures.length > 0 && time === TRIGGER_TIME) {
    const message = createFixturesMessage(fixtures);
    try {
      const response = await slack.chat.postMessage({
        token,
        channel: CHANNEL,
        ...message
      });
      console.log('post message response', response);
      // remove all pins
      const pinsResponse = await slack.pins.list({ token, channel: CHANNEL });
      console.log('pins', pinsResponse.items);
      for (var i = 0; i < pinsResponse.items.length; i++) {
        await slack.pins.remove({
          token,
          channel: CHANNEL,
          timestamp: pinsResponse.items[i].message.ts
        });
      }
      // add message above as pin
      await slack.pins.add({ token, channel: CHANNEL, timestamp: response.ts });
    } catch (e) {
      console.error(e);
      await sendError(e);
    }
  }
}

async function isReady() {
  const test = await slack.api.test({ token });
  if (!test.ok) {
    console.error('Not ready!', test);
    return false;
  }
  console.log('Ready!', test);
  return true;
}

(async function main() {
  const ready = await isReady();
  if (!ready) {
    setTimeout(main, RETRY_INTERVAL);
    return;
  }
  const dt = moment();
  const date = dt.format('YYYY-MM-DD') //'2018-06-15';
  const time = dt.format('HH:mm');
  console.log(date, time);
  // initial fire for dev purposes
  await sendFixtures(date, time);
  await sendMatchStartReminder(date, time);
  setInterval(() => sendFixtures(date, time), INTERVAL);
  setInterval(() => sendMatchStartReminder(date, time), INTERVAL);
})();
