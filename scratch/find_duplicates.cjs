const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = process.cwd();

// Directories to NEVER delete FROM (Source of truth)
const SOURCE_DIRS = [rootDir]; 
// Directories to NEVER delete IN (Build targets)
const BUILD_DIRS = [
  path.join(rootDir, 'android'),
  path.join(rootDir, 'dist'),
  path.join(rootDir, 'node_modules'),
  path.join(rootDir, '.git'),
  path.join(rootDir, '.gemini'),
  path.join(rootDir, 'scratch')
];

function getFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      if (!['node_modules', '.git', '.gemini'].includes(file)) {
        getFiles(filePath, fileList);
      }
    } else {
      fileList.push({
        path: filePath,
        mtime: stats.mtime,
        size: stats.size
      });
    }
  });
  return fileList;
}

function getFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

const allFiles = getFiles(rootDir);
const hashMap = {};

console.log(`Analyzing ${allFiles.length} files...`);

allFiles.forEach(fileObj => {
  try {
    const hash = getFileHash(fileObj.path);
    if (!hashMap[hash]) {
      hashMap[hash] = [];
    }
    hashMap[hash].push(fileObj);
  } catch (err) {
    // console.error(`Error hashing ${fileObj.path}: ${err.message}`);
  }
});

const duplicateSets = Object.values(hashMap).filter(list => list.length > 1);

console.log(`Found ${duplicateSets.length} sets of identical files.\n`);

duplicateSets.forEach((set, index) => {
  // Sort by location preference: Root first, then others
  // Then sort by mtime (newest first)
  set.sort((a, b) => {
    const aIsRoot = path.dirname(a.path) === rootDir;
    const bIsRoot = path.dirname(b.path) === rootDir;
    
    if (aIsRoot && !bIsRoot) return -1;
    if (!aIsRoot && bIsRoot) return 1;
    
    return b.mtime - a.mtime;
  });

  const keep = set[0];
  const toDelete = set.slice(1).filter(file => {
    // PROTECT: Don't delete files in the Android res folder or build folders
    // if the "keep" file is just a duplicate elsewhere.
    // However, if the duplicate is in the ROOT and it's older than another ROOT file, delete it.
    
    const isBuildFile = file.path.includes('\\android\\') || file.path.includes('\\dist\\');
    const keepIsRoot = path.dirname(keep.path) === rootDir;
    const fileIsRoot = path.dirname(file.path) === rootDir;

    if (isBuildFile) return false; // Never delete build artifacts
    if (fileIsRoot && keepIsRoot) return true; // Both in root, keep newest
    if (!fileIsRoot && !keepIsRoot && !isBuildFile) return true; // Both elsewhere (e.g. scratch), keep newest

    return false;
  });

  if (toDelete.length > 0) {
    console.log(`Set ${index + 1}:`);
    console.log(`  [KEEP]   ${keep.path} (${keep.mtime.toISOString()})`);
    toDelete.forEach(file => {
      console.log(`  [DELETE] ${file.path} (${file.mtime.toISOString()})`);
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        console.error(`    FAILED to delete ${file.path}: ${err.message}`);
      }
    });
  }
});

console.log("\nCleanup complete.");
