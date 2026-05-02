const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const rootDir = args[0];
const isDryRun = args.includes('--dry-run');

if (!rootDir) {
    console.error("Please provide a target directory.");
    process.exit(1);
}

const excludedExtensions = ['.jpg', '.jpeg', '.vmlt', '.db', '.vmlf', '.ini', '.bup', '.ifo', '.vob'];

function flatten(currentDir) {
    const items = fs.readdirSync(currentDir);

    items.forEach(item => {
        const fullPath = path.join(currentDir, item);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            flatten(fullPath);
            if (!isDryRun && fs.readdirSync(fullPath).length === 0) {
                fs.rmdirSync(fullPath);
            }
        } else {
            // Skip files already in the root
            if (path.resolve(currentDir) === path.resolve(rootDir)) return;

            const ext = path.extname(item).toLowerCase();
            if (item.startsWith('.') || excludedExtensions.includes(ext)) {
                //if (isDryRun) console.log(`[SKIPPED] ${item}`);
                return;
            }

            // Always prepend the immediate parent folder name
            const parentFolder = path.basename(currentDir);
            const newFileName = `${parentFolder}_${item}`;
            let destPath = path.join(rootDir, newFileName);
            
            // Collision handling for the new prefixed name
            let counter = 1;
            while (fs.existsSync(destPath)) {
                const nameOnly = path.basename(newFileName, path.extname(newFileName));
                const currentExt = path.extname(newFileName);
                destPath = path.join(rootDir, `${nameOnly}_${counter}${currentExt}`);
                counter++;
            }

            if (isDryRun) {
                console.log(`[DRY RUN] Move: ${fullPath}  -->  ${destPath}`);
            } else {
                fs.renameSync(fullPath, destPath);
                console.log(`Moved: ${path.basename(destPath)}`);
            }
        }
    });
}

console.log(isDryRun ? "--- DRY RUN ACTIVE ---" : "--- EXECUTING ---");
flatten(rootDir);
