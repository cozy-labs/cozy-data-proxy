module StatusBar exposing (..)

import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Icons
import Helpers exposing (..)
import Model exposing (Status(..), Platform(..))


-- Status line component


imgIcon : String -> String -> Html msg
imgIcon srcPath className =
    img
        [ src srcPath
        , class <| "status__icon status__icon--" ++ className
        ]
        []


icon : Status -> Platform -> Html msg
icon status platform =
    case platform of
        Darwin ->
            case status of
                UpToDate ->
                    imgIcon "images/tray-icon-osx/idleTemplate@2x.png" "uptodate"

                Offline ->
                    imgIcon "images/tray-icon-osx/pauseTemplate@2x.png" "offline"

                Error _ ->
                    imgIcon "images/tray-icon-osx/errorTemplate@2x.png" "error"

                _ ->
                    span [ class "status__icon spin" ] []

        _ ->
            case status of
                UpToDate ->
                    imgIcon "images/tray-icon-win/idle.png" "uptodate"

                Offline ->
                    imgIcon "images/tray-icon-win/pause.png" "offline"

                Error _ ->
                    imgIcon "images/tray-icon-win/error.png" "error"

                _ ->
                    span [ class "status__icon spin" ] []


viewMessage : Helpers -> Status -> List (Html msg)
viewMessage helpers status =
    case
        status
    of
        UpToDate ->
            [ text (helpers.t "Dashboard Your cozy is up to date!") ]

        Offline ->
            [ text (helpers.t "Dashboard Offline") ]

        Starting ->
            [ text (helpers.t "Dashboard Analyze") ]

        Buffering ->
            [ text (helpers.t "Dashboard Analyze") ]

        SquashPrepMerging ->
            [ text (helpers.t "Dashboard Prepare") ]

        Syncing n ->
            [ text (helpers.t "Dashboard Synchronize")
            , text " ("
            , text (helpers.pluralize n "Dashboard left SINGULAR" "Dashboard left PLURAL")
            , text ")"
            ]

        Error message ->
            [ text (helpers.t "Dashboard Error:")
            , text " "
            , em [] [ text message ]
            ]


view : Helpers -> Status -> Platform -> Html msg
view helpers status platform =
    div
        [ class
            (if platform == Darwin then
                "status"
             else
                "status blue"
            )
        ]
        [ span [ class "status_img" ] [ icon status platform ]
        , span [ class "status_text" ] (viewMessage helpers status)
        ]
