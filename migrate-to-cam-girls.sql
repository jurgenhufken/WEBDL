-- Migrate verplaatste mappen naar CAM-GIRLS parent directory
-- Run met: psql -U jurgen -d webdl -f migrate-to-cam-girls.sql

-- Update downloads table
UPDATE downloads 
SET relpath = 'CAM-GIRLS/' || relpath
WHERE relpath LIKE 'Chatroulette/%'
   OR relpath LIKE 'motherless/%'
   OR relpath LIKE 'omegleporn/%'
   OR relpath LIKE 'rutube/%'
   OR relpath LIKE 'test-examples/%'
   OR relpath LIKE 'videodownloadhelper/%'
   OR relpath LIKE 'xvideos/%'
   OR relpath LIKE '_Downloads te importeren/%';

-- Update screenshots table
UPDATE screenshots
SET relpath = 'CAM-GIRLS/' || relpath
WHERE relpath LIKE 'Chatroulette/%'
   OR relpath LIKE 'motherless/%'
   OR relpath LIKE 'omegleporn/%'
   OR relpath LIKE 'rutube/%'
   OR relpath LIKE 'test-examples/%'
   OR relpath LIKE 'videodownloadhelper/%'
   OR relpath LIKE 'xvideos/%'
   OR relpath LIKE '_Downloads te importeren/%';

-- Toon resultaten
SELECT 'Downloads updated:' as status, COUNT(*) as count
FROM downloads
WHERE relpath LIKE 'CAM-GIRLS/%';

SELECT 'Screenshots updated:' as status, COUNT(*) as count
FROM screenshots
WHERE relpath LIKE 'CAM-GIRLS/%';
