import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI("AIzaSyCiBlW3qhuqaByuECpoZZ6WH7NhcdLCc9s");

async function listModels() {
  try {
    const result = await fetch("https://generativelanguage.googleapis.com/v1/models?key=AIzaSyCiBlW3qhuqaByuECpoZZ6WH7NhcdLCc9s");
    const data = await result.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(error);
  }
}

listModels();
