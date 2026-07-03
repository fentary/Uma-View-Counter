# View Counter (Upstash Redis edition)

A view counter with cute character images, similar to "Moe Counter". Counts
are stored in Upstash Redis, so they persist forever — even if the site
sleeps or you redeploy, nothing resets.

Counters always show **10 digits** with leading zeros (e.g. `0000000007`).
Images are served as real **PNG** files (not SVG), so they work everywhere,
including places that block SVG for security reasons — like osu!'s profile
BBCode editor.

## Full setup, step by step

### 1. Push this project to GitHub

- Create a new repository at https://github.com/new
- Upload every file from this folder to it

### 2. Create the project on Vercel

1. Go to https://vercel.com and sign in with GitHub
2. Click **Add New...** → **Project**
3. Import the repository you just created
4. Leave the default settings and click **Deploy**
   (the first deploy may fail — that's expected, we still need step 3)

### 3. Connect the database (Upstash Redis)

1. Inside your Vercel project, open the **Storage** tab
2. Click **Create Database** (or **Browse Marketplace**)
3. Choose **Upstash** → **Redis**
4. Pick any name and the region closest to your users
5. Confirm, and make sure it's connected to your project

Vercel automatically creates two environment variables for you:
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. You don't need to
copy anything manually.

### 4. Redeploy

1. Go to the **Deployments** tab
2. Click the **...** menu next to the latest deployment → **Redeploy**

### 5. Use it

Open the URL Vercel gave you (e.g. `https://your-project.vercel.app`). Type
a name, click **Generate**, and you'll get:
- a plain image URL
- an HTML `<img>` tag
- a Markdown snippet
- a **BBCode** snippet (for forums, osu! profile, etc.)

## Using it on your osu! profile

1. Go to your profile → **Edit** (you need osu!supporter for this)
2. In the `me!` section editor, click the **Image** button in the BBCode
   toolbar (or type it manually)
3. Paste your counter's URL between the tags:
   ```
   [img]https://your-project.vercel.app/count/your-name[/img]
   ```
4. Save

## Routes

- `GET /count/:name` — increments the counter and returns the PNG image
- `GET /count/:name/preview` — returns the current image **without**
  incrementing (useful for testing)
- `GET /count/:name/raw` — returns the raw number as JSON, e.g.
  `{"name":"your-name","count":42}`

## Testing locally (optional)

You'll need Node.js and an Upstash account (free) with a Redis database
created directly on https://upstash.com. Copy the REST URL and REST TOKEN
into a `.env.local` file:

```
UPSTASH_REDIS_REST_URL=paste_here
UPSTASH_REDIS_REST_TOKEN=paste_here
```

Then:

```
npm install -g vercel
npm install
vercel dev
```
