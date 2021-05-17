const { Client, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const { phoneNumberFormatter } = require('./helpers/formatter');
const axios = require('axios');
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const db = require('./helpers/db')

app.use(express.json());
// app.use(express.urlencoded({
//   extended: true
// }));

(async()=>{
  
  app.get('/', (req, res) => {
    res.sendFile('index.html', {
      root: __dirname
    });
  });

  const savedSession = await db.readSession()
  console.log('save ',savedSession)
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    session: savedSession
  });

  client.on('message', msg => {
    if (msg.body == '!ping') {
      msg.reply('pong');
    } else if (msg.body == 'good morning') {
      msg.reply('selamat pagi');
    } else if (msg.body == '!groups') {
      client.getChats().then(chats => {
        const groups = chats.filter(chat => chat.isGroup);

        if (groups.length == 0) {
          msg.reply('You have no group yet.');
        } else {
          let replyMsg = '*YOUR GROUPS*\n\n';
          groups.forEach((group, i) => {
            replyMsg += `ID: ${group.id._serialized}\nName: ${group.name}\n\n`;
          });
          replyMsg += '_You can use the group id to send a message to the group._'
          msg.reply(replyMsg);
        }
      });
    }
  });

  client.initialize();

  // Socket IO
  io.on('connection', function(socket) {
    socket.emit('message', 'Connecting...');

    client.on('qr', (qr) => {
      console.log('QR RECEIVED', qr);
      qrcode.toDataURL(qr, (err, url) => {
        socket.emit('qr', url);
        socket.emit('message', 'QR Code received, scan please!');
      });
    });

    client.on('ready', () => {
      socket.emit('ready', 'Whatsapp is ready!');
      socket.emit('message', 'Whatsapp is ready!');
    });

    client.on('authenticated', (session) => {
      socket.emit('authenticated', 'Whatsapp is authenticated!');
      socket.emit('message', 'Whatsapp is authenticated!');
      console.log('AUTHENTICATED', session);
      db.saveSession(session)
    });

    client.on('auth_failure', function(session) {
      socket.emit('message', 'Auth failure, restarting...');
    });

    client.on('disconnected', (reason) => {
      socket.emit('message', 'Whatsapp is disconnected!');
      db.removeSession(0)
      client.destroy();
      client.initialize();
    });
  });


  const checkRegisteredNumber = async function(number) {
    const isRegistered = await client.isRegisteredUser(number);
    return isRegistered;
  }

  // Send message
  app.post('/send-message', [
    body('number').notEmpty(),
    body('message').notEmpty(),
  ], async (req, res) => {
    const errors = validationResult(req).formatWith(({
      msg
    }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped()
      });
    }

    const number = phoneNumberFormatter(req.body.number);
    const message = req.body.message;

    const isRegisteredNumber = await checkRegisteredNumber(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }

    client.sendMessage(number, message).then(response => {
      res.status(200).json({
        status: true,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    });
  });

  // send media
  app.post('/send-media',async(req, res)=>{
    const number = phoneNumberFormatter(req.body.nomor)
    const message = req.body.message
    const image = req.body.image

    let mimetype
    const attachment = await axios.get(image,{responseType:'arraybuffer'}).then(response=>{
      mimetype = response.headers['content-type']
      return response.data.toString('base64')
    })
    const media = new MessageMedia(mimetype, attachment, 'image')
    client.sendMessage(number, media, {caption:message})
    .then((response)=>{
      res.status(200).json({
        status:200,
        response: response
      })
    })
    .catch(err=>{
      res.status(500).json({
        status:500,
        response:err
      })
    })
  })

  // send media
  app.post('/send_media',async(req, res)=>{
    const number = phoneNumberFormatter(req.body.nomor)
    const message = req.body.message
    const image = req.body.image

    let mimetype
    const attachment = await axios.get(image,{responseType:'arraybuffer'}).then(response=>{
      mimetype = response.headers['content-type']
      return response.data.toString('base64')
    })
    const media = new MessageMedia(mimetype, attachment, 'image')
    client.sendMessage(number, media, {caption:message})
    .then((response)=>{
      res.status(200).json({
        status:200,
        response:'Message berhasil dikirim ke '+req.body.nomor
      })
    })
    .catch(err=>{
      console.log(err)
      res.status(500).json({
        status:500,
        response:err
      })
    })
  })

  const findGroupByName = async function(name) {
    const group = await client.getChats().then(chats => {
      return chats.find(chat => 
        chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
      );
    });
    return group;
  }

  // Send message to group
  // You can use chatID or group name, yea!
  app.post('/send-group-message', [
    body('id').custom((value, { req }) => {
      if (!value && !req.body.name) {
        throw new Error('Invalid value, you can use `id` or `name`');
      }
      return true;
    }),
    body('message').notEmpty(),
  ], async (req, res) => {
    const errors = validationResult(req).formatWith(({
      msg
    }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped()
      });
    }

    let chatId = req.body.id;
    const groupName = req.body.name;
    const message = req.body.message;

    // Find the group by name
    if (!chatId) {
      const group = await findGroupByName(groupName);
      if (!group) {
        return res.status(422).json({
          status: false,
          message: 'No group found with name: ' + groupName
        });
      }
      chatId = group.id._serialized;
    }

    client.sendMessage(chatId, message).then(response => {
      res.status(200).json({
        status: true,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    });
  });

  server.listen(port, function() {
    console.log('App running on *: ' + port);
  });

})()
