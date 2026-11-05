git switch master &&
rm -rf client/dist &&
npm run bundle &&
cp -r client/public client/dist &&
cp client/index.html client/dist/index.html &&
cp scripts/copyIndexHtml.py client/dist/copyIndexHtml.py &&
git switch gh-pages &&
rm -rf public/ &&
mkdir -p public/ &&
cp client/dist/bundle.js public/ &&
cp -r client/dist/public/. public/ &&
python3 client/dist/copyIndexHtml.py
