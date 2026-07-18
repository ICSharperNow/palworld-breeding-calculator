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
var iconTable = provider.LoadPackageObject<UDataTable>(
    "Pal/Content/Pal/DataTable/Character/DT_PalCharacterIconDataTable.DT_PalCharacterIconDataTable");
int ok = 0, fail = 0;
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
        using var resized = bitmap.Resize(new SKImageInfo(96, 96), SKFilterQuality.High);
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

// --- world map texture for the spawn overlay ---
try
{
    var mapTex = provider.LoadPackageObject<UTexture2D>(
        "Pal/Content/Pal/DataTable/WorldMapUIData/Data/MainWorld5/T_Mainworld5_Combined_221005.T_Mainworld5_Combined_221005");
    using var mapBmp = mapTex.Decode()?.ToSkBitmap();
    if (mapBmp != null)
    {
        using var mapResized = mapBmp.Resize(new SKImageInfo(1400, 1400 * mapBmp.Height / mapBmp.Width), SKFilterQuality.High);
        using var mapImg = SKImage.FromBitmap(mapResized);
        File.WriteAllBytes(Path.Combine(outDir, "worldmap.webp"),
            mapImg.Encode(SKEncodedImageFormat.Webp, 78).ToArray());
        Console.WriteLine($"world map: {mapBmp.Width}x{mapBmp.Height} -> worldmap.webp");
    }
}
catch (Exception e)
{
    Console.WriteLine($"FAIL worldmap: {e.Message}");
}
