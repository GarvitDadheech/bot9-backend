const express = require('express');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { sequelize, testConnection } = require('./sequelize');
const Conversation = require('./Conversation');
const Booking = require('./Booking');
const sendBookingConfirmation = require('./mailer');
const { json } = require('body-parser');
const OpenAI = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.use(cors());
app.use(express.json());
const {GoogleGenerativeAI} = require("@google/generative-ai");
const genAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const API_KEY = process.env.GEMINI_API_KEY; // Set your Gemini API key in .env
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${API_KEY}`;

testConnection().then(() => {
  console.log('Database connection test completed.');
}).catch((error) => {
  console.error('Error testing database connection:', error);
});

const rooms = JSON.parse(fs.readFileSync('hotels.json', 'utf-8'));

let conversationContext = [];
let geminiContext = [];
let bookings = [];
if (fs.existsSync('data.json')) {
  try {
    const bookingsData = fs.readFileSync('data.json', 'utf-8');
    if (bookingsData.trim() !== '') {
      bookings = JSON.parse(bookingsData);
    } else {
      console.log('data.json is empty.');
    }
  } catch (error) {
    console.error('Error reading data.json:', error.message);
  }
}

const getGPT4TurboResponse = async (userQuestion, context) => {

  prompt = "You are a hotel booking assistant who will showcase different rooms to the users and answers according to their queries."
  messages = [{role: 'user', content: userQuestion}, ...context.map(msg => ({role: 'assistant', content: msg}))]

  tools = [
    {
      "type": "function",
      "function": {
        "name": "get_room_data",
        "description": "Get the room data from the user's question and the context of the conversation.",
        "parameters": {}
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_price",
        "description": "Calculate the total cost of the booking and the nights of stay based on the room data and the user's question.",
        "parameters": {
          "type": "object",
          "properties": {
            "room_data": {
              "type": "object",
              "properties": {
                "roomId": {
                  "type": "number"
                },
                "price": {
                  "type": "number"
                },
              }
            },
            "checkInDate": {
              "type": "string"
            },
            "checkOutDate": {
              "type": "string"
            },
            "numberOfRooms": {
              "type": "number"
            }
          },
          "required": ["room_data"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "confirm_booking",
        "description": "Confirm the booking with the user.",
        "parameters": {
          "type": "object",
          "properties": {
            "email": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "phone": {
              "type": "string"
            },
            "numberOfRooms": {
              "type": "number"
            },
            "checkInDate": {
              "type": "string"
            },
            "checkOutDate": {
              "type": "string"
            },
            "Number of nights": {
              "type": "number"
            },
            "Total cost": {
              "type": "number"
            },
            "roomId": {
              "type": "string"
            },
            "Number of guests": {
              "type": "number"
            }
          },
          "required": ["email", "name", "phone", "numberOfRooms", "checkInDate", "checkOutDate", "Number of guests"],
        }
      }
    }
  ]

  response = client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    tools=tools,
    tool_choice="auto",
  )
  try{
  response_message = response.choices[0].message
  tools_calls = response_message.tools_calls

  if(tools_calls){

    available_functions = {
      "get_room_data": get_room_data,
      "get_price": get_price, 
      "confirm_booking" : confirm_booking
    };

    messages.append(response_message);

    for(tool_call in tools_calls){
      function_name = tool_call.function.name;
      function_to_call = available_functions[function_name];
      function_args = json.loads(tool_call.arguments);
      function_response = function_to_call(function_args);
      messages.append(
        {
          "tool_call_id": tool_call.id,
          "role": "tool",
          "name": function_name,
          "content": function_response,
        }
      );
    }
  }

  second_response = client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
  )
    return second_response.choices[0].message.content;
  }
  catch (error){
    return "Sorry, Our servers are down, Please try again after sometime.";
  }
};


// const getGeminiResponse = async (userQuestion, context) => {
//   const prompt = `
//   You are a hotel booking assistant who will showcase different rooms to the users and answer according to their queries only based on the dataset present in the room_data: ${rooms}. Only tell answers from room_data and don't tell extra information. 
//   Please respond with well-formatted, markdown-enhanced steps.
//   Also once the user likes a room or wants to book a specific room then ask for the user's email, name, phone number, number of rooms, check-in date, check-out date. 
//   And then say confirm booking.
//   this is the room data
//   [
//     {"id":1,"name":"Deluxe Room","description":"Spacious room with a king-size bed and city view","price":5000},
//     {"id":2,"name":"Suite","description":"Luxurious suite with separate living area and mountain view","price":8000},
//     {"id":3,"name":"Executive Room","description":"Modern room with work desk and high-speed internet","price":6000},
//     {"id":4,"name":"Family Room","description":"Large room with two queen-size beds, perfect for families","price":7000}
//     ]
// `;

// const messages = [
//   { role: 'system', content: prompt },
//   ...context,
//   { role: 'user', content: userQuestion }
// ];


//   const payload = {
//     contents: messages.map(msg => ({
//       parts: [{ text: msg.content }]
//     }))
//   };
  

//   try {
//     const response = await axios.post(GEMINI_API_URL, payload, {
//       headers: {
//         'Content-Type': 'application/json'
//       }
//     });

//     if (response.status === 200) {
//       const geminiData = response.data;
//       const textOutput = geminiData.candidates[0].content.parts[0].text;
//       return textOutput;
//     } else {
//       console.log("jiii");
//       console.error('Error: Failed to get response from Gemini.');
//       return "Sorry, our servers are down. Please try again later.";
//     }
//   } catch (error) {
//     console.log("jiii");
//     console.error('Error:', error.message || error);
//     return "Sorry, our servers are down. Please try again later.";
//   }
// };

const getGeminiResponse = async (userQuestion, context) => {
  const model = genAi.getGenerativeModel({model: "gemini-pro"});
  const prompt = `
  You are a hotel booking assistant who will showcase different rooms to the users and answer according to their queries only based on the dataset present in the room_data: ${rooms}. Only tell answers from room_data and don't tell extra information. 
  Please respond with well-formatted, markdown-enhanced steps.
  Also once the user likes a room or wants to book a specific room then ask for the user's email, name, phone number, number of rooms, check-in date, check-out date. 
  And then say confirm booking. Be professional and polite.
  Please respond with well-formatted steps. 
  Room Data: ${JSON.stringify(rooms)}`;
  let msgs = prompt + "\n" + context.join("\n") + "\n" + userQuestion;
  const result = await model.generateContent(msgs);
  const response = await result.response;
  const text = response.text();
  return text;
  
}

const get_room_data = () => {
  return rooms;
}

const get_price = (args) => {
  room_data = args.room_data;
  checkInDate = args.checkInDate;
  checkOutDate = args.checkOutDate;
  numberOfRooms = args.numberOfRooms;

  room = rooms.find(room => room.id === room_data.roomId);
  price = room.price * numberOfRooms;
  nights = Math.ceil((new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24));

  return {
    price: price,
    nights: nights
  }

}

const confirm_booking = async (args) => {
  email = args.email;
  name = args.name;
  phone = args.phone;
  numberOfRooms = args.numberOfRooms;
  checkInDate = args.checkInDate;
  checkOutDate = args.checkOutDate;
  numberOfNights = args.numberOfNights;
  totalCost = args.totalCost;
  roomId = room.find(room => room.id === room_data.roomId).id;
  numberOfGuests = args.numberOfGuests;

  bookingDetails = {
    email: email,
    name: name,
    phone: phone,
    numberOfRooms: numberOfRooms,
    checkInDate: checkInDate,
    checkOutDate: checkOutDate,
    numberOfNights: numberOfNights,
    totalCost: totalCost,
    roomId: roomId,
    numberOfGuests: numberOfGuests
  };
  await Booking.create(bookingDetails);
  bookings.push(bookingDetails);
  fs.writeFileSync('data.json', JSON.stringify(bookings, null, 2));
  sendBookingConfirmation(bookingDetails); 
  return "Your booking is confirmed and details are being send to your email, Thank you for your booking!";
}


const main = async (userQuestion, conversationId) => {
  let conversation;

  try {
    conversation = await Conversation.findOne({ where: { conversationId } });
    if (!conversation) {
      conversation = await Conversation.create({ conversationId, messages: [] });
    }
  } catch (error) {
    console.error('Error fetching/creating conversation:', error);
    return 'Error fetching/creating conversation.';
  }

  conversationContext = conversation.messages.map(msg => msg.text);

  // const gpt4TurboResponse = await getGPT4TurboResponse(userQuestion, conversationContext);
  const geminiResponse = await getGeminiResponse(userQuestion, geminiContext);
  geminiContext.push(geminiResponse);
  if (conversation) {
    conversation.messages.push({ sender: 'user', text: userQuestion });
    // conversation.messages.push({ sender: 'assistant', text: gpt4TurboResponse });
    conversation.messages.push({ sender: 'assistant', text: geminiResponse });
    await conversation.save();
  }

  // return gpt4TurboResponse;
  return geminiResponse;
};

app.post('/api/chat', async (req, res) => {
  const { text, conversationId } = req.body;
  
  const response = await main(text, conversationId);
  
  const conversation = await Conversation.findOne({ where: { conversationId } });
  
  res.json({ response, conversation });
});

const PORT = 3001;
sequelize.sync().then(async () => {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
