import OpenAI from "openai";
import sharp from "sharp";
const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey: process.env.MODEL_API_KEY });
const [out, scene] = [process.argv[2]!, process.argv[3]!];
const g = await client.images.generate({
  model: "muse-image-1.0",
  prompt: `Smartphone photo taken from above at a slight angle of a sheet of paper on a table, with a child's drawing: ${scene}. Each figure is drawn separately with clear space between them. Natural light, soft shadow, slightly uneven lighting, realistic photo, not a scan.`,
  n: 1, size: "1536x1024",
  // @ts-expect-error Meta extensions
  reasoning_strength: "low", tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
});
await sharp(Buffer.from(g.data?.[0]?.b64_json ?? "", "base64")).jpeg({ quality: 88 }).toFile(out);
console.log(out);
