module Window.Tray.Settings exposing
    ( Model
    , Msg(..)
    , diskQuotaLine
    , humanReadableDiskValue
    , init
    , update
    , versionLine
    , view
    )

import Data.DiskSpace exposing (DiskSpace)
import Data.Status exposing (Status(..))
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Locale exposing (Helpers)
import Ports
import View.ProgressBar as ProgressBar
import Window.Tray.StatusBar exposing (statusToString)



-- MODEL


type alias Model =
    { version : String
    , newRelease : Maybe ( String, String )
    , autoLaunch : Bool
    , address : String
    , deviceName : String
    , disk : DiskSpace
    , busyUnlinking : Bool
    , busyQuitting : Bool
    , status : Status
    }


init : String -> Model
init version =
    { version = version
    , newRelease = Nothing
    , autoLaunch = True
    , address = ""
    , deviceName = ""
    , disk =
        { used = 0
        , quota = 0
        }
    , busyUnlinking = False
    , busyQuitting = False
    , status = Starting
    }



-- UPDATE


type Msg
    = SetAutoLaunch Bool
    | AutoLaunchSet Bool
    | QuitAndInstall
    | NewRelease ( String, String )
    | FillAddressAndDevice ( String, String )
    | UpdateDiskSpace DiskSpace
    | UnlinkCozy
    | CancelUnlink
    | ShowHelp
    | CloseApp
    | Sync


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case
        msg
    of
        SetAutoLaunch autoLaunch ->
            ( { model | autoLaunch = autoLaunch }, Ports.autoLauncher autoLaunch )

        AutoLaunchSet autoLaunch ->
            ( { model | autoLaunch = autoLaunch }, Cmd.none )

        QuitAndInstall ->
            ( model, Ports.quitAndInstall () )

        NewRelease ( notes, name ) ->
            ( { model | newRelease = Just ( notes, name ) }, Cmd.none )

        FillAddressAndDevice ( address, deviceName ) ->
            ( { model | address = address, deviceName = deviceName }, Cmd.none )

        UpdateDiskSpace disk ->
            ( { model | disk = disk }, Cmd.none )

        UnlinkCozy ->
            ( { model | busyUnlinking = True }, Ports.unlinkCozy () )

        CancelUnlink ->
            ( { model | busyUnlinking = False }, Cmd.none )

        ShowHelp ->
            ( model, Ports.showHelp () )

        CloseApp ->
            ( { model | busyQuitting = True }, Ports.closeApp () )

        Sync ->
            ( model, Ports.manualStartSync () )



-- VIEW


humanReadableDiskValue : Helpers -> Float -> String
humanReadableDiskValue helpers v =
    String.fromInt (round (v / 1000000)) ++ " M" ++ helpers.t "Account b"


diskQuotaLine : Helpers -> Model -> Html Msg
diskQuotaLine helpers model =
    if model.disk.quota == 0 then
        div []
            [ text (humanReadableDiskValue helpers model.disk.used ++ " / ∞") ]

    else
        div []
            [ text
                (humanReadableDiskValue helpers model.disk.used
                    ++ " / "
                    ++ humanReadableDiskValue helpers model.disk.quota
                )
            , ProgressBar.view (model.disk.used / model.disk.quota)
            ]


versionLine : Helpers -> Model -> Html Msg
versionLine helpers model =
    case model.newRelease of
        Just ( name, changes ) ->
            span [ class "version-need-update" ]
                [ text model.version
                , a [ onClick QuitAndInstall, href "#", class "btn btn--action" ]
                    [ text (helpers.t "Settings Install the new release and restart the application") ]
                ]

        Nothing ->
            span [ class "version-uptodate" ] [ text model.version ]


view : Helpers -> Model -> Html Msg
view helpers model =
    section [ class "two-panes__content two-panes__content--settings" ]
        [ h2 [] [ text (helpers.t "Account Cozy disk space") ]
        , diskQuotaLine helpers model
        , h2 [] [ text (helpers.t "Settings Start Cozy Drive on system startup") ]
        , div
            [ class "coz-form-toggle"
            ]
            [ span [ class "toggle" ]
                [ input
                    [ type_ "checkbox"
                    , checked model.autoLaunch
                    , id "auto-launch"
                    , class "checkbox"
                    , onCheck SetAutoLaunch
                    ]
                    []
                , label [ class "label", for "auto-launch" ] []
                ]
            , text (helpers.t "Settings Startup")
            ]
        , h2 [] [ text (helpers.t "Settings Synchronize manually") ]
        , syncButton helpers model.status
        , h2 [] [ text (helpers.t "Account About") ]
        , p []
            [ strong [] [ text (helpers.t "Account Account" ++ " ") ]
            , a [ href model.address ] [ text model.address ]
            ]
        , p []
            [ strong [] [ text (helpers.t "Account Device name" ++ " ") ]
            , text model.deviceName
            ]
        , p []
            [ strong [] [ text (helpers.t "Settings Version" ++ " ") ]
            , versionLine helpers model
            ]
        , h2 [] [ text (helpers.t "Help Help") ]
        , a
            [ class "btn"
            , href "#"
            , onClick ShowHelp
            ]
            [ text (helpers.t "Help Send us a message") ]
        , h2 [] [ text (helpers.t "Tray Quit application") ]
        , a
            [ class "btn btn--danger"
            , href "#"
            , if model.busyQuitting then
                attribute "aria-busy" "true"

              else
                onClick CloseApp
            ]
            [ text (helpers.t "AppMenu Quit") ]
        , h2 [] [ text (helpers.t "Account Unlink Cozy") ]
        , p []
            [ text (helpers.t "Account It will unlink your account to this computer." ++ " ")
            , text (helpers.t "Account Your files won't be deleted." ++ " ")
            , text (helpers.t "Account Are you sure to unlink this account?" ++ " ")
            ]
        , a
            [ class "btn btn--danger"
            , href "#"
            , if model.busyUnlinking then
                attribute "aria-busy" "true"

              else
                onClick UnlinkCozy
            ]
            [ text (helpers.t "Account Unlink this Cozy") ]
        ]


syncButton : Helpers -> Status -> Html Msg
syncButton helpers status =
    case status of
        UpToDate ->
            a
                [ class "btn"
                , href "#"
                , onClick Sync
                ]
                [ text (helpers.t "Settings Sync") ]

        _ ->
            a
                [ class "btn"
                , href "#"
                , attribute "disabled" "true"
                ]
                [ text (statusToString helpers status) ]
