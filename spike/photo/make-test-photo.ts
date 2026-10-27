// Test input only: a generated stand-in for a real phone photo of a hand drawing, until a real one is shot.
import OpenAI from "openai";
import sharp from "sharp";
const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey: process.env.MODEL_API_KEY });
const g = await client.images.generate({
  model: "muse-image-1.0",
  prompt: "Smartphone photo taken from above at a slight angle of a sheet of white printer paper on a wooden table, with a child's marker and crayon drawing: a smiling cat, a small house with a red roof, a yellow sun, a green tree and a blue car, each drawn separately with space between them. Natural indoor light, soft shadow of the phone on one corner, slightly uneven lighting, realistic photo, not a scan.",
  n: 1, size: "1536x1024",
  // @ts-expect-error Meta extensions
  reasoning_strength: "low", tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
});
await sharp(Buffer.from(g.data?.[0]?.b64_json ?? "", "base64")).jpeg({ quality: 88 }).toFile(process.argv[2]);
