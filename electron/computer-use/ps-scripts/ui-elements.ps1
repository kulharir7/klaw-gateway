param([string]$Action, [string]$Arg1, [string]$Arg2)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$auto = [System.Windows.Automation.AutomationElement]

switch ($Action) {
    "list" {
        # List all clickable/interactive elements in foreground window
        $root = $auto::FocusedElement
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        
        # Get the top-level window
        $window = $root
        while ($window -ne $null) {
            $parent = $walker.GetParent($window)
            if ($parent -eq $auto::RootElement -or $parent -eq $null) { break }
            $window = $parent
        }
        if ($window -eq $null) { $window = $auto::RootElement }
        
        $condition = [System.Windows.Automation.Condition]::TrueCondition
        $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        
        $results = @()
        foreach ($el in $elements) {
            try {
                $rect = $el.Current.BoundingRectangle
                if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
                if ($rect.X -lt -10000) { continue }  # offscreen
                
                $name = $el.Current.Name
                $type = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
                $clickable = $type -match 'Button|MenuItem|Hyperlink|ListItem|TabItem|TreeItem|CheckBox|RadioButton|ComboBox'
                $editable = $type -match 'Edit|Document'
                
                if (-not $name -and -not $clickable -and -not $editable) { continue }
                
                $cx = [int]($rect.X + $rect.Width / 2)
                $cy = [int]($rect.Y + $rect.Height / 2)
                
                $results += "$type|$cx|$cy|$([int]$rect.Width)|$([int]$rect.Height)|$name"
            } catch { continue }
        }
        
        # Limit to 50 most relevant
        $results | Select-Object -First 50
    }
    
    "find" {
        # Find element by name/text (partial match)
        $search = $Arg1.ToLower()
        $window = $auto::FocusedElement
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        while ($window -ne $null) {
            $parent = $walker.GetParent($window)
            if ($parent -eq $auto::RootElement -or $parent -eq $null) { break }
            $window = $parent
        }
        if ($window -eq $null) { $window = $auto::RootElement }
        
        $condition = [System.Windows.Automation.Condition]::TrueCondition
        $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        
        foreach ($el in $elements) {
            try {
                $name = $el.Current.Name
                if (-not $name) { continue }
                if ($name.ToLower().Contains($search)) {
                    $rect = $el.Current.BoundingRectangle
                    if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
                    $type = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
                    $cx = [int]($rect.X + $rect.Width / 2)
                    $cy = [int]($rect.Y + $rect.Height / 2)
                    Write-Output "$type|$cx|$cy|$([int]$rect.Width)|$([int]$rect.Height)|$name"
                }
            } catch { continue }
        }
    }
    
    "focused" {
        # Get info about currently focused element
        $el = $auto::FocusedElement
        try {
            $rect = $el.Current.BoundingRectangle
            $type = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
            $name = $el.Current.Name
            $cx = [int]($rect.X + $rect.Width / 2)
            $cy = [int]($rect.Y + $rect.Height / 2)
            Write-Output "$type|$cx|$cy|$([int]$rect.Width)|$([int]$rect.Height)|$name"
        } catch {
            Write-Output "Unknown|0|0|0|0|"
        }
    }
    
    default { Write-Error "Unknown action: $Action. Use: list, find, focused" }
}
