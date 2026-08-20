// Run: node src/seed.js
require('dotenv').config();
const prisma = require('./utils/prisma');

// All prices stored in PAISE (1 rupee = 100 paise)
// Tiers: [[minQty, maxQty, priceInPaise], ...]
const products = [
  // ── SEEDS ──────────────────────────────────────────
  { name:'Paddy Hybrid MTU 7029',          brand:'Pioneer Seeds',    category:'seeds',        size:'5 kg / bag',           mrp:80000,  cert:'CIB', unit:'bag',     moq:10,  step:10,  inStock:true,  stockQty:480, tiers:[[10,49,68000],[50,99,64000],[100,9999,59000]] },
  { name:'Cotton Hybrid Bunny BG-II',       brand:'Rasi Seeds',       category:'seeds',        size:'450 g / packet',       mrp:95000,  cert:'CIB', unit:'packet',  moq:20,  step:20,  inStock:true,  stockQty:320, tiers:[[20,99,85000],[100,249,80000],[250,9999,76000]] },
  { name:'VNR Sponge Gourd Alok F1 Hybrid', brand:'VNR Seeds',        category:'seeds',        size:'10 gm / packet',       mrp:7600,   cert:'CIB', unit:'packet',  moq:50,  step:50,  inStock:true,  stockQty:600, tiers:[[50,199,6500],[200,499,5800],[500,9999,5200]] },
  { name:'Kalash BSS-928 F1 Hybrid Sponge Gourd', brand:'Kalash Seeds', category:'seeds',     size:'10 gm × 5 pack',       mrp:32000,  cert:'CIB', unit:'pack',    moq:24,  step:24,  inStock:true,  stockQty:400, tiers:[[24,99,31000],[100,249,29000],[250,9999,27000]] },
  { name:'Kalash Poorva French Beans',      brand:'Kalash Seeds',     category:'seeds',        size:'100 gm / pack',        mrp:9400,   cert:'CIB', unit:'pack',    moq:24,  step:24,  inStock:true,  stockQty:240, tiers:[[24,99,8500],[100,249,7800],[250,9999,7200]] },
  { name:'Indo Us Mallika Cowpea Seeds',    brand:'Indo Us',          category:'seeds',        size:'100 gm / pack',        mrp:9900,   cert:'CIB', unit:'pack',    moq:50,  step:50,  inStock:true,  stockQty:380, tiers:[[50,199,8000],[200,499,7400],[500,9999,6800]] },

  // ── PESTICIDES ─────────────────────────────────────
  { name:'Monocrotophos 36% SL',            brand:'Bayer CropScience', category:'pesticides', size:'1 litre / bottle',     mrp:48000,  cert:'CIB', unit:'bottle',  moq:12,  step:12,  inStock:true,  stockQty:1200, tiers:[[12,47,42000],[48,119,39500],[120,9999,36800]] },
  { name:'IIL Bispyribac Sodium 10% SC',    brand:'IIL India',        category:'pesticides',  size:'10 ml / bottle',       mrp:9500,   cert:'CIB', unit:'bottle',  moq:24,  step:24,  inStock:true,  stockQty:800,  tiers:[[24,99,9000],[100,299,8200],[300,9999,7500]] },
  { name:'HPM Freedom Mix Metsulfuron 10%', brand:'HPM Agro',         category:'pesticides',  size:'8 gm / sachet',        mrp:18000,  cert:'CIB', unit:'sachet',  moq:50,  step:50,  inStock:true,  stockQty:500,  tiers:[[50,199,9000],[200,499,8200],[500,9999,7500]] },
  { name:'Tata Rallis Ralwet 75 Spreader',  brand:'Tata Rallis',      category:'pesticides',  size:'25 ml × 4 / pack',     mrp:29200,  cert:'CIB', unit:'pack',    moq:24,  step:24,  inStock:true,  stockQty:360,  tiers:[[24,99,28600],[100,249,26800],[250,9999,25000]] },

  // ── INSECTICIDES ───────────────────────────────────
  { name:'Coragen 20% SC (Chlorantraniliprole)', brand:'FMC India',   category:'insecticides', size:'150 ml / unit',       mrp:138000, cert:'CIB', unit:'unit',    moq:6,   step:6,   inStock:false, stockQty:84,   tiers:[[6,23,124000],[24,59,116000],[60,9999,108000]] },
  { name:'Dhanuka Superkiller Cypermethrin 10%', brand:'Dhanuka Agritech', category:'insecticides', size:'100 ml / bottle', mrp:6800,  cert:'CIB', unit:'bottle',  moq:24,  step:24,  inStock:true,  stockQty:960,  tiers:[[24,99,6500],[100,299,6000],[300,9999,5500]] },
  { name:'HPM 7 Star Thiamethoxam 25% WG',  brand:'HPM Agro',        category:'insecticides', size:'5 gm / sachet',        mrp:4800,   cert:'CIB', unit:'sachet',  moq:50,  step:50,  inStock:true,  stockQty:720,  tiers:[[50,199,3800],[200,499,3400],[500,9999,3000]] },
  { name:'SAI Killer Imidacloprid 70% WG',  brand:'SAI Agro',        category:'insecticides', size:'2 gm × 5 / strip',     mrp:32500,  cert:'CIB', unit:'strip',   moq:50,  step:50,  inStock:true,  stockQty:400,  tiers:[[50,199,30500],[200,499,28000],[500,9999,25800]] },
  { name:'Tropical Agro Emamectin 5% SG',   brand:'Tropical Agro',   category:'insecticides', size:'10 gm / sachet',       mrp:12000,  cert:'CIB', unit:'sachet',  moq:50,  step:50,  inStock:true,  stockQty:600,  tiers:[[50,199,10000],[200,499,9000],[500,9999,8200]] },
  { name:'Sai Volga Emamectin Benzoate',     brand:'SAI Agro',        category:'insecticides', size:'10 gm / sachet',       mrp:8100,   cert:'CIB', unit:'sachet',  moq:50,  step:50,  inStock:true,  stockQty:500,  tiers:[[50,199,7500],[200,499,6800],[500,9999,6200]] },

  // ── FERTILISERS ────────────────────────────────────
  { name:'DAP (Diammonium Phosphate)',       brand:'IFFCO',           category:'fertilisers',  size:'50 kg / bag',          mrp:145000, cert:'FCO', unit:'bag',     moq:4,   step:4,   inStock:true,  stockQty:620,  tiers:[[4,19,135000],[20,49,128000],[50,9999,120000]] },
  { name:'Aries Agromin Max Micronutrient', brand:'Aries Agro',      category:'fertilisers',  size:'1 kg / pack',          mrp:96000,  cert:'FCO', unit:'pack',    moq:12,  step:12,  inStock:true,  stockQty:380,  tiers:[[12,49,66500],[50,119,62000],[120,9999,58000]] },
  { name:'Multiplex Jivras Humic Acid',     brand:'Multiplex',       category:'fertilisers',  size:'100 ml / bottle',      mrp:19000,  cert:'FCO', unit:'bottle',  moq:24,  step:24,  inStock:true,  stockQty:500,  tiers:[[24,99,11500],[100,299,10500],[300,9999,9600]] },
  { name:'Tropical Agro Tag Bio Stimulant', brand:'Tropical Agro',   category:'fertilisers',  size:'500 gm / pack',        mrp:280000, cert:'FCO', unit:'pack',    moq:6,   step:6,   inStock:true,  stockQty:180,  tiers:[[6,23,175000],[24,59,162000],[60,9999,150000]] },

  // ── FUNGICIDES ─────────────────────────────────────
  { name:'Ridomil Gold 68 WG',              brand:'Syngenta India',   category:'fungicides',   size:'1 kg / pack',          mrp:110000, cert:'CIB', unit:'pack',    moq:5,   step:5,   inStock:true,  stockQty:210,  tiers:[[5,24,96000],[25,74,90000],[75,9999,84000]] },
  { name:'Indofil M-45 Broad Spectrum',     brand:'Indofil',          category:'fungicides',   size:'100 gm / pack',        mrp:12000,  cert:'CIB', unit:'pack',    moq:50,  step:50,  inStock:true,  stockQty:880,  tiers:[[50,199,10500],[200,499,9600],[500,9999,8800]] },
  { name:'Crystal Bavistin Carbendazim 50%', brand:'Crystal Crop',   category:'fungicides',   size:'100 gm / pack',        mrp:20000,  cert:'CIB', unit:'pack',    moq:24,  step:24,  inStock:true,  stockQty:640,  tiers:[[24,99,14200],[100,249,13000],[250,9999,12000]] },
  { name:'HPM Hindustan M-45 Mancozeb 75%', brand:'HPM Agro',        category:'fungicides',   size:'100 gm × 2 / pack',    mrp:39300,  cert:'CIB', unit:'pack',    moq:50,  step:50,  inStock:true,  stockQty:320,  tiers:[[50,199,14800],[200,499,13600],[500,9999,12400]] },

  // ── HERBICIDES ─────────────────────────────────────
  { name:'Exylon Glyphosafe Ammonium 71%',  brand:'Exylon',          category:'herbicides',   size:'100 gm / pack',        mrp:45400,  cert:'CIB', unit:'pack',    moq:50,  step:50,  inStock:true,  stockQty:400,  tiers:[[50,199,12900],[200,499,11800],[500,9999,10800]] },
  { name:'Crystal Topper 77 Glyphosate',    brand:'Crystal Crop',    category:'herbicides',   size:'100 gm / pack',        mrp:19500,  cert:'CIB', unit:'pack',    moq:50,  step:50,  inStock:true,  stockQty:360,  tiers:[[50,199,14400],[200,499,13200],[500,9999,12000]] },
  { name:'Silver Crop Special Metsil Combo', brand:'Silver Crop',    category:'herbicides',   size:'8 gm + 200 ml / pack', mrp:15000,  cert:'CIB', unit:'pack',    moq:50,  step:50,  inStock:true,  stockQty:280,  tiers:[[50,199,14000],[200,499,12800],[500,9999,11600]] },
];

async function main() {
  console.log('Seeding products…');

  // Clear existing
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();

  for (const p of products) {
    await prisma.product.create({ data: p });
    process.stdout.write('.');
  }

  console.log(`\nDone — ${products.length} products seeded.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());