// GameRoom Durable Object — placeholder (Step 5 မှာ round timer + WebSocket ဖြည့်မယ်)
// wrangler.toml မှာ bind လုပ်ထားတဲ့ class ကို export လုပ်ဖို့ လိုလို့ ကြိုထည့်ထားတာ။

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return new Response("GameRoom placeholder (Step 5)", { status: 501 });
  }
}
