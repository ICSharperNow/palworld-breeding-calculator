using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports.Engine;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json;
using SkiaSharp;

var extractedDir = args[0];
var usmapPath = args[1];
var outDir = args[2];
Directory.CreateDirectory(outDir);

var provider = new DefaultFileProvider(extractedDir, SearchOption.AllDirectories,
    new VersionContainer(Enum.Parse<EGame>(args.Length > 3 ? args[3] : "GAME_UE5_1")));
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmapPath);
provider.Initialize();
provider.Mount();

var targets = new[]
{
    "Pal/Content/Pal/DataTable/Character/DT_PalMonsterParameter",
    "Pal/Content/Pal/DataTable/Character/DT_PalCombiUnique",
    "Pal/Content/Pal/DataTable/PassiveSkill/DT_PassiveSkill_Main",
    "Pal/Content/L10N/en/Pal/DataTable/Text/DT_PalNameText_Common",
    "Pal/Content/L10N/en/Pal/DataTable/Text/DT_SkillNameText_Common",
    "Pal/Content/L10N/en/Pal/DataTable/Text/DT_SkillDescText_Common",
    "Pal/Content/Pal/DataTable/UI/DT_PaldexDistributionData",
    "Pal/Content/Pal/DataTable/WorldMapUIData/DT_WorldMapUIData",
};

foreach (var path in targets)
{
    var name = Path.GetFileName(path);
    try
    {
        var table = provider.LoadPackageObject<UDataTable>($"{path}.{name}");
        var json = JsonConvert.SerializeObject(table, Formatting.Indented);
        File.WriteAllText(Path.Combine(outDir, name + ".json"), json);
        Console.WriteLine($"OK {name} ({table.RowMap.Count} rows)");
    }
    catch (Exception e)
    {
        Console.WriteLine($"FAIL {name}: {e.Message}");
    }
}

// --- pal icons: decode textures, downscale, write webp per character id ---
var iconDir = Path.Combine(outDir, "icons");
Directory.CreateDirectory(iconDir);
UDataTable? iconTable = null;
try
{
    iconTable = provider.LoadPackageObject<UDataTable>(
        "Pal/Content/Pal/DataTable/Character/DT_PalCharacterIconDataTable.DT_PalCharacterIconDataTable");
}
catch (Exception e)
{
    Console.WriteLine($"FAIL icon table: {e.Message}");
}
int ok = 0, fail = 0;
if (iconTable != null)
foreach (var (rowName, row) in iconTable.RowMap)
{
    try
    {
        var soft = row.Get<CUE4Parse.UE4.Objects.UObject.FSoftObjectPath>("Icon");
        // AssetPathName is already "/Game/...path.objectname"
        var objPath = soft.AssetPathName.Text.Replace("/Game/", "Pal/Content/");
        var tex = provider.LoadPackageObject<UTexture2D>(objPath);
        using var bitmap = tex.Decode()?.ToSkBitmap();
        if (bitmap == null) { fail++; continue; }
        using var resized = bitmap.Resize(new SKImageInfo(160, 160), SKFilterQuality.High);
        using var img = SKImage.FromBitmap(resized);
        using var data = img.Encode(SKEncodedImageFormat.Webp, 80);
        File.WriteAllBytes(Path.Combine(iconDir, rowName.Text + ".webp"), data.ToArray());
        ok++;
    }
    catch (Exception e)
    {
        if (fail == 0) Console.WriteLine($"first icon failure ({rowName.Text}): {e}");
        fail++;
    }
}
Console.WriteLine($"icons: {ok} ok, {fail} failed");

// crop transparent padding around a glyph, keeping a small margin
static SKBitmap TrimAlpha(SKBitmap src)
{
    int minX = src.Width, minY = src.Height, maxX = -1, maxY = -1;
    for (int y = 0; y < src.Height; y++)
        for (int x = 0; x < src.Width; x++)
            if (src.GetPixel(x, y).Alpha > 16)
            {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
    if (maxX < 0) return src;
    var margin = Math.Max(2, (maxX - minX) / 12);
    minX = Math.Max(0, minX - margin);
    minY = Math.Max(0, minY - margin);
    maxX = Math.Min(src.Width - 1, maxX + margin);
    maxY = Math.Min(src.Height - 1, maxY + margin);
    // keep it square, centered on the glyph
    var w = maxX - minX + 1;
    var h = maxY - minY + 1;
    var size = Math.Max(w, h);
    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;
    var left = Math.Max(0, Math.Min(src.Width - size, cx - size / 2));
    var top = Math.Max(0, Math.Min(src.Height - size, cy - size / 2));
    var outBmp = new SKBitmap(size, size);
    src.ExtractSubset(outBmp, new SKRectI(left, top, left + size, top + size));
    return outBmp;
}

// --- work suitability icons (the in-game ones) ---
var workIconDir = Path.Combine(outDir, "workicons");
Directory.CreateDirectory(workIconDir);
var workIcons = new[]
{
    "EmitFlame", "Watering", "Seeding", "GenerateElectricity", "Handcraft",
    "Collection", "Deforest", "Mining", "ProductMedicine", "Cool", "Transport", "MonsterFarm",
};
foreach (var w in workIcons)
{
    try
    {
        var tex = provider.LoadPackageObject<UTexture2D>(
            $"Pal/Content/Pal/Texture/UI/InGame/SkillIcon/T_icon_skill_pal_WorkRank_{w}.T_icon_skill_pal_WorkRank_{w}");
        using var bmp = tex.Decode()?.ToSkBitmap();
        if (bmp == null) { Console.WriteLine($"FAIL workicon {w}"); continue; }
        using var trimmed = TrimAlpha(bmp);
        using var rs = trimmed.Resize(new SKImageInfo(48, 48), SKFilterQuality.High);
        using var img = SKImage.FromBitmap(rs);
        File.WriteAllBytes(Path.Combine(workIconDir, w + ".webp"), img.Encode(SKEncodedImageFormat.Webp, 85).ToArray());
    }
    catch (Exception e) { Console.WriteLine($"FAIL workicon {w}: {e.Message}"); }
}
// no dedicated WorkRank icon for oil extraction; the research oil icon matches the in-game look
try
{
    var oil = provider.LoadPackageObject<UTexture2D>(
        "Pal/Content/Pal/Texture/UI/IngameMenu/Research/EffectIcon/T_icon_Research_OilSpeed.T_icon_Research_OilSpeed");
    using var bmp = oil.Decode()?.ToSkBitmap();
    if (bmp != null)
    {
        using var trimmed = TrimAlpha(bmp);
        using var rs = trimmed.Resize(new SKImageInfo(48, 48), SKFilterQuality.High);
        using var img = SKImage.FromBitmap(rs);
        File.WriteAllBytes(Path.Combine(workIconDir, "OilExtraction.webp"), img.Encode(SKEncodedImageFormat.Webp, 85).ToArray());
    }
}
catch (Exception e) { Console.WriteLine($"FAIL workicon OilExtraction: {e.Message}"); }
Console.WriteLine("work icons exported");

// --- world map texture for the spawn overlay ---
try
{
    // T_WorldMap is the current in-game world map (referenced by DT_WorldMapUIData);
    // T_TreeMap is the World Tree interior map
    foreach (var (texName, fileName, outW) in new[]
    {
        ("T_WorldMap", "worldmap.webp", 3072),
        ("T_TreeMap", "treemap.webp", 2048),
    })
    {
        var mapTex = provider.LoadPackageObject<UTexture2D>(
            $"Pal/Content/Pal/Texture/UI/Map/{texName}.{texName}");
        using var mapBmp = mapTex.Decode()?.ToSkBitmap();
        if (mapBmp == null) { Console.WriteLine($"FAIL {texName}: decode"); continue; }
        using var mapResized = mapBmp.Resize(new SKImageInfo(outW, outW * mapBmp.Height / mapBmp.Width), SKFilterQuality.High);
        // flatten onto opaque dark water so alpha in the source can't wash the colors out
        using var surface = SKSurface.Create(new SKImageInfo(mapResized.Width, mapResized.Height, SKColorType.Rgb888x));
        surface.Canvas.Clear(new SKColor(12, 44, 74));
        surface.Canvas.DrawBitmap(mapResized, 0, 0);
        using var mapImg = surface.Snapshot();
        File.WriteAllBytes(Path.Combine(outDir, fileName),
            mapImg.Encode(SKEncodedImageFormat.Webp, 82).ToArray());
        Console.WriteLine($"{texName}: {mapBmp.Width}x{mapBmp.Height} -> {fileName}");
    }
}
catch (Exception e)
{
    Console.WriteLine($"FAIL worldmap: {e.Message}");
}
