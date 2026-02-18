import { serve } from 'https://deno.land/std@0.167.0/http/server.ts';
import { stringify } from 'https://jspm.dev/uuid';

// 🔴 YOUR HARDCODED UUID
const userID = 'b57c8dd9-7bdb-43fd-cd86-c36e9e1fe1fd';

const handler = async (req: Request): Promise<Response> => {
  const upgrade = req.headers.get('upgrade') || '';
  
  // 🟢 THIS MAKES THE WARM-UP PASS
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response("Deno VPN is Online", { status: 200 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  let remoteConnection: Deno.TcpConn;

  socket.onopen = () => console.log('Connected');
  socket.onmessage = async (e) => {
    try {
      if (!(e.data instanceof ArrayBuffer)) return;
      const vlessBuffer = e.data;

      if (remoteConnection) {
        await remoteConnection.write(new Uint8Array(vlessBuffer));
      } else {
        // Validate UUID from packet
        if (stringify(new Uint8Array(vlessBuffer.slice(1, 17))) !== userID) return;

        const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
        const command = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
        if (command !== 1) return;

        const portIndex = 18 + optLength + 1;
        const port = new DataView(vlessBuffer.slice(portIndex, portIndex + 2)).getInt16(0);
        
        const addressType = new Uint8Array(vlessBuffer.slice(portIndex + 2, portIndex + 3))[0];
        let address = '';
        let addressLength = 0;
        let addressValueIndex = portIndex + 3;

        if (addressType === 1) {
          addressLength = 4;
          address = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 4)).join('.');
        } else if (addressType === 2) {
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
    } catch { socket.close(); }
  };

  return response;
};

// 🔵 Deno Deploy will automatically assign the port if we don't force 8080
serve(handler);
