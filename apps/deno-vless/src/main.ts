import { serve } from 'https://deno.land/std@0.167.0/http/server.ts';
import { stringify } from 'https://jspm.dev/uuid';

const userID = 'b57c8dd9-7bdb-43fd-cd86-c36e9e1fe1fd';

const handler = async (req: Request): Promise<Response> => {
  const upgrade = req.headers.get('upgrade') || '';

  // 🟢 Catch-all Health Check
  // If it's not a VPN handshake, show the online message regardless of path
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response("Deno VPN is Online", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  // 🔵 VLESS Websocket Logic
  try {
    const { socket, response } = Deno.upgradeWebSocket(req);
    let remoteConnection: Deno.TcpConn;

    socket.onopen = () => console.log('VPN Tunnel Opened');

    socket.onmessage = async (e) => {
      try {
        if (!(e.data instanceof ArrayBuffer)) return;
        const vlessBuffer = e.data;

        if (remoteConnection) {
          await remoteConnection.write(new Uint8Array(vlessBuffer));
        } else {
          // Handshake Validation
          if (vlessBuffer.byteLength < 24) return;
          const clientID = stringify(new Uint8Array(vlessBuffer.slice(1, 17)));
          if (clientID !== userID) return;

          const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
          const command = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
          if (command !== 1) { socket.close(); return; }

          const portIndex = 18 + optLength + 1;
          const port = new DataView(vlessBuffer.slice(portIndex, portIndex + 2)).getInt16(0);
          const addressType = new Uint8Array(vlessBuffer.slice(portIndex + 2, portIndex + 3))[0];
          
          let address = '';
          let addressValueIndex = portIndex + 3;
          let addressLength = 0;

          if (addressType === 1) { // IPv4
            addressLength = 4;
            address = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 4)).join('.');
          } else if (addressType === 2) { // Domain
            addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
            addressValueIndex++;
            address = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
          }

          remoteConnection = await Deno.connect({ port, hostname: address });
          const rawClientData = vlessBuffer.slice(addressValueIndex + addressLength);
          await remoteConnection.write(new Uint8Array(rawClientData));

          remoteConnection.readable.pipeTo(new WritableStream({
            start() { socket.send(new Blob([new Uint8Array([0, 0])])); },
            write(chunk) { socket.send(new Blob([chunk])); }
          })).catch(() => {});
        }
      } catch (err) { socket.close(); }
    };

    socket.onclose = () => console.log('Tunnel Closed');
    return response;
  } catch (err) {
    return new Response("WebSocket upgrade failed", { status: 400 });
  }
};

serve(handler);
