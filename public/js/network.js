// Thin wrapper around a WebSocket connection to the game server.
// Translates typed server messages into callback invocations, and
// exposes small helpers for sending client events.

export class Network {
  constructor(handlers) {
    this.ws = null;
    this.id = null;
    this.handlers = handlers;
  }

  // `loadout` is { name, weapon, skin, mapPreference } — sent once, right
  // after the socket opens, as the player's "join" message. The server
  // locks in the match's map from whichever player joins first.
  connect(url, loadout) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;

      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }

      this.ws = ws;

      ws.onopen = () => {
        this.send({ type: 'join', ...loadout });
        settled = true;
        resolve();
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Could not reach the server at ' + url));
        }
      };

      ws.onclose = () => {
        this.handlers.onDisconnect?.();
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'welcome':
            this.id = msg.id;
            this.handlers.onWelcome?.(msg);
            break;
          case 'join':
            this.handlers.onJoin?.(msg.player);
            break;
          case 'leave':
            this.handlers.onLeave?.(msg.id);
            break;
          case 'update':
            this.handlers.onUpdate?.(msg);
            break;
          case 'shoot':
            this.handlers.onShoot?.(msg);
            break;
          case 'kill':
            this.handlers.onKill?.(msg);
            break;
          case 'health':
            this.handlers.onHealth?.(msg);
            break;
          case 'respawn':
            this.handlers.onRespawn?.(msg);
            break;
          case 'roundStart':
            this.handlers.onRoundStart?.(msg);
            break;
          case 'roundClear':
            this.handlers.onRoundClear?.(msg);
            break;
          case 'zombieTick':
            this.handlers.onZombieTick?.(msg);
            break;
          case 'zombieHealth':
            this.handlers.onZombieHealth?.(msg);
            break;
          case 'zombieDeath':
            this.handlers.onZombieDeath?.(msg);
            break;
          default:
            break;
        }
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendUpdate(x, y, z, angle) {
    this.send({ type: 'update', x, y, z, angle });
  }

  sendShoot() {
    this.send({ type: 'shoot' });
  }

  sendHit(targetId, damage) {
    this.send({ type: 'hit', targetId, damage });
  }

  sendZombieHit(targetId, damage) {
    this.send({ type: 'zombieHit', targetId, damage });
  }
}
