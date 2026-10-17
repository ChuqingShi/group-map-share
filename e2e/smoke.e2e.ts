// Scenarios 1 and 2: the room basics work in a real browser.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { SPOTS, crewCount, crewIds, eventually, leaveRoom, setup, waitForCrew } from './harness.ts';

const { scenario } = setup();

scenario('1. smoke: create a room, join as Ann, one avatar, no console errors', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);

  assert.match(ann.page.url(), /\/r\/[\w-]+/, 'the creator lands in the room');
  await waitForCrew(ann, 1);
  // The server has us as the only member, with the simulated position.
  const welcome = ann.welcomes[0];
  assert.deepEqual(welcome.players.map((p) => p.name), ['Ann']);
  await eventually(
    () => assert.ok(ann.received.some((m) => m.t === 'player' && m.player.id === ann.id && m.player.pos)),
    { message: 'Ann position reached the server' },
  );
  const pos = (ann.received.find((m) => m.t === 'player' && m.player.id === ann.id && m.player.pos) as { player: { pos: { lat: number; lng: number } } }).player.pos;
  assert.ok(Math.abs(pos.lat - SPOTS.ann[0]) < 0.01 && Math.abs(pos.lng - SPOTS.ann[1]) < 0.01, 'position comes from ?sim');

  await sleep(1000); // let late errors (map, fonts, websocket) show up
  ann.assertNoErrors();
});

scenario('2. two people: Bob joins Ann, both see two avatars, Bob leaves, Ann sees one', async (s) => {
  const ann = await s.player('Ann', SPOTS.ann);
  await waitForCrew(ann, 1);

  const bob = await s.player('Bob', SPOTS.bob, { roomUrl: ann.roomUrl });
  assert.equal(bob.roomId, ann.roomId);
  await Promise.all([waitForCrew(ann, 2), waitForCrew(bob, 2)]);

  // The crew strip lists the same two people on both screens.
  if ((await ann.tid('crew').count()) > 0) {
    const [a, b] = await Promise.all([crewIds(ann), crewIds(bob)]);
    assert.deepEqual([...a].sort(), [ann.id, bob.id].sort());
    assert.deepEqual([...b].sort(), [ann.id, bob.id].sort());
  }

  await leaveRoom(bob);
  await eventually(() => assert.ok(ann.received.some((m) => m.t === 'left' && m.id === bob.id)), { message: 'Ann is told Bob left' });
  await waitForCrew(ann, 1);
  assert.equal(await crewCount(ann), 1);

  ann.assertNoErrors();
  bob.assertNoErrors();
});
