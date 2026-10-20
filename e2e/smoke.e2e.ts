// Scenarios 1 and 2: the room basics work in a real browser.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { SPOTS, crewCount, crewIds, eventually, leaveRoom, setup, waitForCrew } from './harness.ts';

const { scenario } = setup();

scenario('1. smoke: create a room, join as Breeca, one avatar, no console errors', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);

  assert.match(breeca.page.url(), /\/r\/[\w-]+/, 'the creator lands in the room');
  await waitForCrew(breeca, 1);
  // The server has us as the only member, with the simulated position.
  const welcome = breeca.welcomes[0];
  assert.deepEqual(welcome.players.map((p) => p.name), ['Breeca']);
  await eventually(
    () => assert.ok(breeca.received.some((m) => m.t === 'player' && m.player.id === breeca.id && m.player.pos)),
    { message: 'Breeca position reached the server' },
  );
  const pos = (breeca.received.find((m) => m.t === 'player' && m.player.id === breeca.id && m.player.pos) as { player: { pos: { lat: number; lng: number } } }).player.pos;
  assert.ok(Math.abs(pos.lat - SPOTS.breeca[0]) < 0.01 && Math.abs(pos.lng - SPOTS.breeca[1]) < 0.01, 'position comes from ?sim');

  await sleep(1000); // let late errors (map, fonts, websocket) show up
  breeca.assertNoErrors();
});

scenario('2. two people: Eric joins Breeca, both see two avatars, Eric leaves, Breeca sees one', async (s) => {
  const breeca = await s.player('Breeca', SPOTS.breeca);
  await waitForCrew(breeca, 1);

  const eric = await s.player('Eric', SPOTS.eric, { roomUrl: breeca.roomUrl });
  assert.equal(eric.roomId, breeca.roomId);
  await Promise.all([waitForCrew(breeca, 2), waitForCrew(eric, 2)]);

  // The crew strip lists the same two people on both screens.
  if ((await breeca.tid('crew').count()) > 0) {
    const [a, b] = await Promise.all([crewIds(breeca), crewIds(eric)]);
    assert.deepEqual([...a].sort(), [breeca.id, eric.id].sort());
    assert.deepEqual([...b].sort(), [breeca.id, eric.id].sort());
  }

  await leaveRoom(eric);
  await eventually(() => assert.ok(breeca.received.some((m) => m.t === 'left' && m.id === eric.id)), { message: 'Breeca is told Eric left' });
  await waitForCrew(breeca, 1);
  assert.equal(await crewCount(breeca), 1);

  breeca.assertNoErrors();
  eric.assertNoErrors();
});
