module.exports = {
  apps : [
   {
      name: "ai-server",
      script: "ai_server.py",         
      interpreter: "python3",
      cwd: "/app/AI",               
    },
    {
      name: "voice-server",
      script: "python3",  
      args: "-m uvicorn AI.mcp_server:app --host 0.0.0.0 --port 8766", 
      cwd: "/app",
      env: {
        "ELEVEN_API_KEY": process.env.ELEVEN_API_KEY
      }
    },
    {
      name: "game-server",
      script: "npm",
      args: "run preview",
      cwd: "/app/racing-game",
    },
    {
      name: "tunnel",
      script: "cloudflared",
      args: "tunnel --config /app/config.yml run",
      cwd: "/app",
    }
  ]
};