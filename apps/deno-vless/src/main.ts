import { serve } from 'https://deno.land/std@0.167.0/http/server.ts';
import { stringify } from 'https://jspm.dev/uuid';

const userID = 'b57c8dd9-7bdb-43fd-cd86-c36e9e1fe1fd';

const handler = async (req: Request): Promise<Response> => {
  const upgrade = req.headers.get('upgrade') || '';

  // 🟢 FORCED RESPONSE: Answer 200 to EVERYTHING that isn't a VPN
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response("Deno VPN is Online", { status: 200 });
  }

  // 🔵 VPN HANDSHAKE: Handle the websocket regardless of the URL path
  try {
    const { socket, response } = Deno.upgradeWebSocket(req);
    let remoteConnection: Deno.TcpConn;

    socket.onmessage = async (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const buffer = e.data;

      if (remoteConnection) {
        await remoteConnection.write(new Uint8Array(buffer));
      } else {
        // Simple VLESS check
        const clientID = stringify(new Uint8Array(buffer.slice(1, 17)));
        if (clientID !== userID) return;

        const optLength = new Uint8Array(buffer.slice(17, 18))[0];
        const portIndex = 18 + optLength + 1;
        const port = new DataView(buffer.slice(portIndex, portIndex + 2)).getInt16(0);
        const addressType = new Uint8Array(buffer.slice(portIndex + 2, portIndex + 3))[0];
        
        let address = '';
        let addressValueIndex = portIndex + 3;
        let addressLength = 0;

        if (addressType === 1) { // IPv4
          addressLength = 4;
          address = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + 4)).join('.');
        } else if (addressType === 2) { // Domain
          addressLength = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + 1))[0];
          addressValueIndex++;
          address = new TextDecoder().decode(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
        }

        remoteConnection = await Deno.connect({ port, hostname: address });
        const rawClientData = buffer.slice(addressValueIndex + addressLength);
        await remoteConnection.write(new Uint8Array(rawClientData));

        remoteConnection.readable.pipeTo(new WritableStream({
          start() { socket.send(new Blob([new Uint8Array([0, 0])])); },
          write(chunk) { socket.send(new Blob([chunk])); }
        })).catch(() => {});
      }
    };
    return response;
  } catch (err) {
    return new Response("Upgrade failed", { status: 400 });
  }
};

serve(handler);
