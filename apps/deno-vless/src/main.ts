import { serve } from 'https://deno.land/std@0.167.0/http/server.ts';
import { stringify } from 'https://jspm.dev/uuid';
import { chunk } from 'https://jspm.dev/lodash-es';

// 🔴 HARDCODED UUID - DO NOT CHANGE
const userID = 'b57c8dd9-7bdb-43fd-cd86-c36e9e1fe1fd';
const isVaildUser = true;

const handler = async (req: Request): Promise<Response> => {
  // 🟢 HEALTH CHECK BLOCK: Satisfies Deno's "Warm up" robot
  const url = new URL(req.url);
  const upgrade = req.headers.get('upgrade') || '';
  
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response("Deno VLESS is Active and Healthy!", { 
      status: 200, 
      headers: { "content-type": "text/plain" } 
    });
  }

  // 🔵 START VLESS WEBSOCKET LOGIC
  const { socket, response } = Deno.upgradeWebSocket(req);
  let remoteConnection: Deno.TcpConn;
  let address = '';
  let port = 0;

  socket.onopen = () => console.log('VPN Connection Opened');
  
  socket.onmessage = async (e) => {
    try {
      if (!(e.data instanceof ArrayBuffer)) return;
      const vlessBuffer: ArrayBuffer = e.data;

      if (remoteConnection) {
        await remoteConnection.write(new Uint8Array(vlessBuffer));
      } else {
        if (vlessBuffer.byteLength < 24) return;
        
        // Validate UUID from incoming packet
        if (stringify(new Uint8Array(vlessBuffer.slice(1, 17))) !== userID) {
          console.log('Unauthorized connection attempt');
          return;
        }

        const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
        const command = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
        
        if (command !== 1) {
          socket.close();
          return;
        }

        const portIndex = 18 + optLength + 1;
        const portRemote = new DataView(vlessBuffer.slice(portIndex, portIndex + 2)).getInt16(0);
        port = portRemote;
        
        let addressIndex = portIndex + 2;
        const addressType = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1))[0];
        let addressLength = 0;
        let addressValueIndex = addressIndex + 1;
        let addressValue = '';

        if (addressType === 1) {
          addressLength = 4;
          addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join('.');
        } else if (addressType === 2) {
          addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
          addressValueIndex += 1;
          addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
        }

        address = addressValue;
        console.log(`Connecting to ${address}:${port}`);
        
        remoteConnection = await Deno.connect({ port, hostname: address });
        const rawClientData = vlessBuffer.slice(addressValueIndex + addressLength);
        await remoteConnection.write(new Uint8Array(rawClientData));

        remoteConnection.readable.pipeTo(new WritableStream({
          start() { socket.send(new Blob([new Uint8Array([0, 0])])); },
          write(chunk) { socket.send(new Blob([chunk])); }
        })).catch(err => console.log('Remote connection closed'));
      }
    } catch (err) {
      socket.close();
    }
  };

  return response;
};

serve(handler);
